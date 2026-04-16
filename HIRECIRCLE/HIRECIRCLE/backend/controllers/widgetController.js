const ApiKey = require('../models/ApiKey');
const {
    createWidgetSessionToken,
    createWidgetToken,
    resolveApiKeyFromWidgetToken,
    resolveWidgetRequestDomain,
    SESSION_TOKEN_TTL_SECONDS,
} = require('../services/widgetTokenService');

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

const resolveBootstrapTokenFromRequest = (req = {}) => String(
    req.body?.token
    || req.headers?.['x-widget-token']
    || req.headers?.['x-hire-widget-token']
    || req.query?.token
    || ''
).trim();

const buildIframeCode = ({ baseUrl, matchWidgetUrl, token }) => `\
<div data-hire-match-widget></div>
<script>
(() => {
  const mount = document.currentScript.previousElementSibling;
  const base = ${escapeJs(baseUrl)};
  const bootstrapToken = ${escapeJs(token)};
  const widgetUrl = ${escapeJs(matchWidgetUrl)};

  const showError = (message) => {
    mount.innerHTML = '<div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; border: 1px solid #fecaca; border-radius: 12px; padding: 14px; color: #b91c1c;">'
      + String(message || 'Widget failed to load.')
      + '</div>';
  };

  const bootstrap = async () => {
    const response = await fetch(base + '/embed/widget-bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: bootstrapToken }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Widget bootstrap failed');
    }
    const sessionToken = payload?.data?.sessionToken || '';
    if (!sessionToken) {
      throw new Error('Widget session token missing');
    }
    return sessionToken;
  };

  bootstrap()
    .then((sessionToken) => {
      const frame = document.createElement('iframe');
      frame.src = widgetUrl;
      frame.name = JSON.stringify({ sessionToken });
      frame.loading = 'lazy';
      frame.style.width = '100%';
      frame.style.minHeight = '620px';
      frame.style.border = '0';
      frame.style.borderRadius = '12px';
      mount.replaceChildren(frame);
    })
    .catch((error) => {
      showError(error.message || 'Widget failed to load.');
    });
})();
</script>`;

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
        const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
        const scriptUrl = `${normalizedBaseUrl}/embed/hire-widget.js`;
        const matchWidgetUrl = `${normalizedBaseUrl}/embed/match-widget`;

        return res.json({
            success: true,
            data: {
                token,
                scriptUrl,
                bootstrapUrl: `${normalizedBaseUrl}/embed/widget-bootstrap`,
                matchWidgetUrl,
                previewUrl: matchWidgetUrl,
                embedCode: `<script src="${scriptUrl}" data-hire-widget-token="${token}" async></script><div data-hire-widget></div>`,
                iframeCode: buildIframeCode({ baseUrl: normalizedBaseUrl, matchWidgetUrl, token }),
                expiresInSeconds: Number(payload.ttlSeconds || process.env.WIDGET_TOKEN_TTL_SECONDS || 1800),
            },
        });
    } catch (error) {
        return res.status(400).json({ message: error.message || 'Failed to create widget token' });
    }
};

const bootstrapWidgetSessionController = async (req, res) => {
    try {
        const bootstrapToken = resolveBootstrapTokenFromRequest(req);
        if (!bootstrapToken) {
            return res.status(400).json({ message: 'Widget token is required' });
        }

        const requestDomain = resolveWidgetRequestDomain(req);
        const { apiKeyDoc, tokenPayload } = await resolveApiKeyFromWidgetToken({
            token: bootstrapToken,
            requestDomain,
        });

        const sessionToken = createWidgetSessionToken({
            apiKeyId: apiKeyDoc._id,
            ownerId: tokenPayload?.ownerId || apiKeyDoc.ownerId || apiKeyDoc.employerId || null,
            tenantId: tokenPayload?.tenantId || apiKeyDoc.organization || null,
        });

        res.set('Cache-Control', 'no-store');
        return res.json({
            success: true,
            data: {
                sessionToken,
                expiresInSeconds: SESSION_TOKEN_TTL_SECONDS,
            },
        });
    } catch (error) {
        return res.status(401).json({ message: error.message || 'Failed to bootstrap widget session' });
    }
};

const serveHireWidgetScript = async (req, res) => {
    const script = `(() => {
  const currentScript = document.currentScript || document.querySelector('script[src*=\"/embed/hire-widget.js\"]');
  const base = currentScript ? new URL(currentScript.src).origin : window.location.origin;
  const bootstrapToken = (currentScript && currentScript.dataset && currentScript.dataset.hireWidgetToken)
    || (currentScript ? new URL(currentScript.src).searchParams.get('token') : '')
    || '';
  const state = { jobs: [] };
  let sessionToken = '';

  const root = document.querySelector('[data-hire-widget]') || (() => {
    const el = document.createElement('div');
    el.setAttribute('data-hire-widget', '');
    document.body.appendChild(el);
    return el;
  })();

  const showError = (message) => {
    root.innerHTML = '<div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; border: 1px solid #fecaca; border-radius: 10px; padding: 12px; color: #b91c1c;">'
      + String(message || 'Widget failed to load.')
      + '</div>';
  };

  root.innerHTML = '<div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; border: 1px solid #d0d7de; border-radius: 10px; padding: 12px;"><strong>Loading jobs...</strong></div>';

  const bootstrapSession = async () => {
    if (!bootstrapToken) {
      throw new Error('Hire widget token is required');
    }

    const response = await fetch(base + '/embed/widget-bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: bootstrapToken }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || 'Widget bootstrap failed');
    }

    const nextToken = payload?.data?.sessionToken || '';
    if (!nextToken) {
      throw new Error('Widget session token missing');
    }
    sessionToken = nextToken;
    return nextToken;
  };

  const getHeaders = () => ({
    'Content-Type': 'application/json',
    'X-Widget-Token': sessionToken,
  });

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
          headers: getHeaders(),
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

  bootstrapSession()
    .then(() => fetch(base + '/api/v3/public/jobs?limit=10', { headers: getHeaders() }))
    .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
    .then(({ ok, payload }) => {
      if (!ok) {
        throw new Error(payload.message || 'Widget failed to load jobs');
      }
      state.jobs = Array.isArray(payload.data) ? payload.data : [];
      renderJobs();
    })
    .catch((error) => {
      showError(error.message || 'Unknown error');
    });
})();`;

    res.set('Cache-Control', 'public, max-age=60');
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    return res.status(200).send(script);
};

module.exports = {
    bootstrapWidgetSessionController,
    createWidgetSessionTokenController,
    serveHireWidgetScript,
};
