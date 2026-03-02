const ApiKey = require('../models/ApiKey');
const { createWidgetToken } = require('../services/widgetTokenService');

const normalizeHost = (value = '') => {
    const input = String(value || '').trim();
    if (!input) return '';
    try {
        const parsed = input.includes('://') ? new URL(input) : new URL(`https://${input}`);
        return String(parsed.hostname || '').toLowerCase();
    } catch (_error) {
        return input.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    }
};

const ensureAllowedDomain = ({ apiKeyDoc, allowedDomain }) => {
    const domain = normalizeHost(allowedDomain);
    if (!domain) {
        throw new Error('allowedDomain is required');
    }

    const allowlist = Array.isArray(apiKeyDoc.allowedDomains)
        ? apiKeyDoc.allowedDomains.map((entry) => normalizeHost(entry)).filter(Boolean)
        : [];

    if (allowlist.length && !allowlist.includes(domain)) {
        throw new Error('allowedDomain is not in API key allowlist');
    }

    return domain;
};

const escapeJs = (value = '') => JSON.stringify(String(value || ''));

const createWidgetSessionTokenController = async (req, res) => {
    try {
        const payload = req.body || {};
        const apiKeyId = String(payload.apiKeyId || '').trim();

        const apiKeyDoc = apiKeyId
            ? await ApiKey.findOne({
                _id: apiKeyId,
                ownerId: req.user._id,
                isActive: true,
                revoked: { $ne: true },
            })
            : await ApiKey.findOne({
                ownerId: req.user._id,
                isActive: true,
                revoked: { $ne: true },
            }).sort({ createdAt: -1 });

        if (!apiKeyDoc) {
            return res.status(404).json({ message: 'No active API key found for employer' });
        }

        const allowedDomain = ensureAllowedDomain({
            apiKeyDoc,
            allowedDomain: payload.allowedDomain,
        });

        const token = createWidgetToken({
            apiKeyId: apiKeyDoc._id,
            ownerId: req.user._id,
            tenantId: req.user.organizationId || null,
            allowedDomain,
            ttlSeconds: payload.ttlSeconds,
        });

        const baseUrl = String(payload.baseUrl || '').trim() || `${req.protocol}://${req.get('host')}`;
        const scriptUrl = `${baseUrl.replace(/\/$/, '')}/embed/hire-widget.js?token=${encodeURIComponent(token)}`;

        return res.json({
            success: true,
            data: {
                token,
                scriptUrl,
                embedCode: `<script src="${scriptUrl}" async></script><div data-hire-widget></div>`,
                expiresInSeconds: Number(payload.ttlSeconds || process.env.WIDGET_TOKEN_TTL_SECONDS || 1800),
            },
        });
    } catch (error) {
        return res.status(400).json({ message: error.message || 'Failed to create widget token' });
    }
};

const serveHireWidgetScript = async (req, res) => {
    const token = String(req.query.token || '').trim();
    if (!token) {
        return res.status(400).type('application/javascript').send('console.error("Hire widget token is required");');
    }

    const script = `(() => {
  const token = ${escapeJs(token)};
  const currentScript = document.currentScript || document.querySelector('script[src*=\"/embed/hire-widget.js\"]');
  const base = currentScript ? new URL(currentScript.src).origin : window.location.origin;
  const state = { jobs: [] };

  const root = document.querySelector('[data-hire-widget]') || (() => {
    const el = document.createElement('div');
    el.setAttribute('data-hire-widget', '');
    document.body.appendChild(el);
    return el;
  })();

  root.innerHTML = '<div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; border: 1px solid #d0d7de; border-radius: 10px; padding: 12px;"><strong>Loading jobs...</strong></div>';

  const headers = {
    'Content-Type': 'application/json',
    'X-Widget-Token': token,
  };

  const renderJobs = () => {
    const cards = state.jobs.map((job) => {
      return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px;">'
        + '<div style="font-weight:700;margin-bottom:4px;">' + (job.title || 'Role') + '</div>'
        + '<div style="font-size:12px;color:#4b5563;margin-bottom:8px;">' + (job.companyName || '') + ' • ' + (job.location || '') + '</div>'
        + '<button data-job="' + job.externalId + '" style="background:#111827;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer;">Apply</button>'
        + '</div>';
    }).join('');

    root.innerHTML = '<div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif;">'
      + '<div style="font-weight:700;margin-bottom:10px;">Open Jobs</div>'
      + cards
      + '<div id="hire-widget-form"></div>'
      + '</div>';

    root.querySelectorAll('button[data-job]').forEach((button) => {
      button.addEventListener('click', () => showApplyForm(button.getAttribute('data-job')));
    });
  };

  const showApplyForm = (externalJobId) => {
    const formRoot = root.querySelector('#hire-widget-form');
    formRoot.innerHTML = '<div style="margin-top:10px;padding:10px;border:1px solid #d1d5db;border-radius:8px;">'
      + '<div style="font-weight:600;margin-bottom:8px;">Apply</div>'
      + '<input id="hire-w-name" placeholder="Name" style="display:block;width:100%;margin-bottom:6px;padding:8px;border:1px solid #d1d5db;border-radius:6px;" />'
      + '<input id="hire-w-email" placeholder="Email" style="display:block;width:100%;margin-bottom:6px;padding:8px;border:1px solid #d1d5db;border-radius:6px;" />'
      + '<input id="hire-w-city" placeholder="City" style="display:block;width:100%;margin-bottom:6px;padding:8px;border:1px solid #d1d5db;border-radius:6px;" />'
      + '<button id="hire-w-submit" style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:8px 12px;cursor:pointer;">Submit Application</button>'
      + '<div id="hire-w-status" style="margin-top:8px;font-size:12px;color:#374151;"></div>'
      + '</div>';

    const submitButton = root.querySelector('#hire-w-submit');
    const status = root.querySelector('#hire-w-status');

    submitButton.addEventListener('click', async () => {
      status.textContent = 'Submitting...';
      const match = state.jobs.find((job) => job.externalId === externalJobId);
      if (!match || !match.externalId) {
        status.textContent = 'Unable to resolve selected job.';
        return;
      }

      const payload = {
        externalJobId: String(match.externalId || ''),
        candidate: {
          firstName: root.querySelector('#hire-w-name').value,
          email: root.querySelector('#hire-w-email').value,
          city: root.querySelector('#hire-w-city').value,
        },
      };

      try {
        const response = await fetch(base + '/api/v3/public/applications', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || 'Application failed');
        }
        status.textContent = 'Application submitted successfully.';
      } catch (error) {
        status.textContent = error.message || 'Application failed.';
      }
    });
  };

  fetch(base + '/api/v3/public/jobs?limit=10', { headers })
    .then((response) => response.json())
    .then((payload) => {
      state.jobs = Array.isArray(payload.data) ? payload.data : [];
      renderJobs();
    })
    .catch((error) => {
      root.innerHTML = '<div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; border: 1px solid #fecaca; border-radius: 10px; padding: 12px; color: #b91c1c;">Widget failed: ' + (error.message || 'Unknown error') + '</div>';
    });
})();`;

    res.set('Cache-Control', 'public, max-age=60');
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    return res.status(200).send(script);
};

module.exports = {
    createWidgetSessionTokenController,
    serveHireWidgetScript,
};
