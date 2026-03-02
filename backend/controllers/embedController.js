const { findApiKeyByRawValue } = require('../services/externalApiKeyService');

const normalizeHost = (value = '') => {
    const input = String(value || '').trim();
    if (!input) return '';
    try {
        const parsed = input.includes('://') ? new URL(input) : new URL(`https://${input}`);
        return String(parsed.hostname || '').toLowerCase();
    } catch (error) {
        return input.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    }
};

const escapeHtml = (value = '') => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const isAllowedReferrer = (allowlist = [], referrer = '') => {
    const domains = Array.isArray(allowlist)
        ? allowlist.map(normalizeHost).filter(Boolean)
        : [];

    if (!domains.length) return true;
    if (!referrer) return false;

    const refHost = normalizeHost(referrer);
    if (!refHost) return false;

    return domains.some((allowed) => (
        refHost === allowed || refHost.endsWith(`.${allowed}`)
    ));
};

// @desc White-label embeddable match widget
// @route GET /embed/match-widget?apiKey=
const renderMatchWidget = async (req, res) => {
    const rawKey = String(req.query.apiKey || req.query.api_key || '').trim();
    if (!rawKey) {
        return res.status(400).send('apiKey query parameter is required');
    }

    const apiKeyDoc = await findApiKeyByRawValue(rawKey);

    if (!apiKeyDoc || apiKeyDoc.isActive === false || apiKeyDoc.revoked) {
        return res.status(401).send('Invalid API key');
    }

    const referrer = req.get('referer') || '';
    if (!isAllowedReferrer(apiKeyDoc.allowedDomains, referrer)) {
        return res.status(403).send('Embedding domain not allowed for this API key');
    }

    const safeApiKey = escapeHtml(rawKey);
    const safePlan = escapeHtml(apiKeyDoc.planType || 'free');
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HIRE Match Widget</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
    .wrap { padding: 14px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 10px; }
    h1 { font-size: 16px; margin: 0 0 8px 0; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    label { font-size: 12px; color: #334155; display: block; margin-bottom: 3px; }
    input, textarea, select { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; font-size: 12px; }
    textarea { min-height: 56px; resize: vertical; }
    button { border: none; background: #2563eb; color: #fff; border-radius: 6px; padding: 8px 10px; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: 0.7; cursor: wait; }
    pre { white-space: pre-wrap; font-size: 11px; background: #0f172a; color: #e2e8f0; padding: 10px; border-radius: 8px; max-height: 240px; overflow: auto; }
    .muted { font-size: 11px; color: #64748b; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>HIRE Match Preview</h1>
      <div class="muted">Plan: ${safePlan}. Powered by deterministic + probabilistic scoring.</div>
      <div class="grid">
        <div>
          <label>Worker City</label>
          <input id="workerCity" value="Hyderabad" />
        </div>
        <div>
          <label>Role Name</label>
          <input id="roleName" value="Driver" />
        </div>
      </div>
      <div class="grid">
        <div>
          <label>Expected Salary</label>
          <input id="expectedSalary" type="number" value="18000" />
        </div>
        <div>
          <label>Preferred Shift</label>
          <select id="preferredShift">
            <option>Day</option>
            <option>Night</option>
            <option selected>Flexible</option>
          </select>
        </div>
      </div>
      <label>Worker Skills (comma separated)</label>
      <input id="skills" value="Driving,Route Planning" />
      <hr />
      <div class="grid">
        <div>
          <label>Job Title</label>
          <input id="jobTitle" value="Driver" />
        </div>
        <div>
          <label>Job City</label>
          <input id="jobLocation" value="Hyderabad" />
        </div>
      </div>
      <div class="grid">
        <div>
          <label>Job Max Salary</label>
          <input id="jobMaxSalary" type="number" value="22000" />
        </div>
        <div>
          <label>Job Shift</label>
          <select id="jobShift">
            <option>Day</option>
            <option>Night</option>
            <option selected>Flexible</option>
          </select>
        </div>
      </div>
      <label>Job Requirements (comma separated)</label>
      <input id="requirements" value="Driving,Route Planning" />
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button id="btnMatch">Run Match</button>
        <button id="btnFill">Predict Fill</button>
      </div>
    </div>
    <div class="card">
      <pre id="output">Ready</pre>
    </div>
  </div>
  <script>
    const apiKey = "${safeApiKey}";
    const output = document.getElementById('output');
    const asList = (value) => String(value || '').split(',').map(v => v.trim()).filter(Boolean);
    const buildPayload = () => {
      const worker = {
        city: document.getElementById('workerCity').value,
        preferredShift: document.getElementById('preferredShift').value,
        interviewVerified: true,
        hasCompletedProfile: true,
        roleProfiles: [{
          roleName: document.getElementById('roleName').value,
          expectedSalary: Number(document.getElementById('expectedSalary').value || 0),
          skills: asList(document.getElementById('skills').value),
          experienceInRole: 2
        }]
      };
      const job = {
        title: document.getElementById('jobTitle').value,
        location: document.getElementById('jobLocation').value,
        maxSalary: Number(document.getElementById('jobMaxSalary').value || 0),
        shift: document.getElementById('jobShift').value,
        requirements: asList(document.getElementById('requirements').value)
      };
      return { worker, job };
    };

    const request = async (path, payload) => {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'Request failed');
      }
      return data;
    };

    document.getElementById('btnMatch').addEventListener('click', async () => {
      try {
        output.textContent = 'Running match...';
        const result = await request('/api/platform/match', buildPayload());
        output.textContent = JSON.stringify(result, null, 2);
      } catch (error) {
        output.textContent = error.message;
      }
    });

    document.getElementById('btnFill').addEventListener('click', async () => {
      try {
        output.textContent = 'Predicting fill...';
        const payload = buildPayload();
        const result = await request('/api/platform/predict-fill', { job: payload.job });
        output.textContent = JSON.stringify(result, null, 2);
      } catch (error) {
        output.textContent = error.message;
      }
    });
  </script>
</body>
</html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
};

module.exports = {
    renderMatchWidget,
};
