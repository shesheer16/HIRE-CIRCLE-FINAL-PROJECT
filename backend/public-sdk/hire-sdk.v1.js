(function initHireSdk(global) {
  const VERSION = '1.0.0';
  const state = {
    apiKey: null,
    baseUrl: '',
    defaultHeaders: {},
  };

  const resolveBaseUrl = (input) => {
    const base = String(input || '').trim();
    if (!base) return '';
    return base.replace(/\/$/, '');
  };

  const requireApiKey = () => {
    if (!state.apiKey) {
      throw new Error('hireSDK.init(apiKey) must be called first');
    }
  };

  const request = async (path, options = {}) => {
    requireApiKey();

    const url = `${state.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': state.apiKey,
      ...state.defaultHeaders,
      ...(options.headers || {}),
    };

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.message || `Request failed with status ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  };

  const hireSDK = {
    version: VERSION,

    init(apiKey, options = {}) {
      const normalizedKey = String(apiKey || '').trim();
      if (!normalizedKey) {
        throw new Error('Valid API key is required');
      }
      state.apiKey = normalizedKey;
      state.baseUrl = resolveBaseUrl(options.baseUrl || window.location.origin);
      state.defaultHeaders = options.headers || {};
      return this;
    },

    getJobs(params = {}) {
      const search = new URLSearchParams();
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          search.set(key, String(value));
        }
      });
      const query = search.toString() ? `?${search.toString()}` : '';
      return request(`/api/v3/public/jobs${query}`);
    },

    apply(payload = {}) {
      return request('/api/v3/public/applications', {
        method: 'POST',
        body: payload,
      });
    },

    getProfile(employerId) {
      if (!employerId) throw new Error('employerId is required');
      return request(`/api/v3/public/employers/${encodeURIComponent(String(employerId))}/profile`);
    },
  };

  global.hireSDK = hireSDK;
})(typeof window !== 'undefined' ? window : globalThis);
