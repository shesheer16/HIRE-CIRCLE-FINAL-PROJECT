import axios from 'axios';
import { buildApiUrl } from '../config/api';

const WEB_SESSION_KEY = 'webSession';
const BROWSER_SESSION_HEADERS = {
  'X-Session-Mode': 'browser',
};
export const LOGIN_NOTICE_QUERY_PARAM = 'notice';
export const LOGIN_NOTICE_SESSION_EXPIRED = 'session-expired';

let accessToken = '';
let refreshPromise = null;

const getStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage;
};

const toStoredSession = (payload = {}) => ({
  _id: payload._id || null,
  name: payload.name || '',
  email: payload.email || '',
  role: payload.role || '',
  roles: Array.isArray(payload.roles) ? payload.roles : [],
  activeRole: payload.activeRole || '',
  primaryRole: payload.primaryRole || '',
  capabilities: payload.capabilities || {},
  hasSelectedRole: Boolean(payload.hasSelectedRole),
  hasCompletedProfile: Boolean(payload.hasCompletedProfile),
  isVerified: Boolean(payload.isVerified),
  isAdmin: Boolean(payload.isAdmin),
});

export const resolveWebHomePath = (session = null) => (
  String(session?.role || '').trim().toLowerCase() === 'recruiter'
    ? '/recruiter/jobs'
    : '/candidate/jobs'
);

const isRequestedPathAllowedForSession = (session = null, requestedPath = '') => {
  const normalizedPath = String(requestedPath || '').trim();
  if (!normalizedPath.startsWith('/')) {
    return false;
  }

  const normalizedRole = String(session?.role || '').trim().toLowerCase();
  if (normalizedRole === 'recruiter') {
    return /^\/recruiter(?:\/|$)/.test(normalizedPath);
  }

  return /^\/candidate(?:\/|$)/.test(normalizedPath);
};

export const resolvePostLoginPath = (session = null, requestedPath = '') => (
  isRequestedPathAllowedForSession(session, requestedPath)
    ? String(requestedPath || '').trim()
    : resolveWebHomePath(session)
);

export const getWebSession = () => {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(WEB_SESSION_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch (_error) {
    storage.removeItem(WEB_SESSION_KEY);
    return null;
  }
};

export const completeWebLogin = (payload = {}) => {
  accessToken = String(payload.token || '').trim();
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(WEB_SESSION_KEY, JSON.stringify(toStoredSession(payload)));
};

export const clearWebAuthSession = () => {
  accessToken = '';
  refreshPromise = null;
  const storage = getStorage();
  storage?.removeItem(WEB_SESSION_KEY);
};

export const ensureWebAccessToken = async () => {
  if (accessToken) {
    return accessToken;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = axios.post(
    buildApiUrl('/api/users/refresh-token'),
    {},
    {
      withCredentials: true,
      headers: BROWSER_SESSION_HEADERS,
    }
  )
    .then(({ data }) => {
      completeWebLogin(data);
      return accessToken;
    })
    .catch(() => {
      clearWebAuthSession();
      return '';
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
};

export const logoutWebSession = async () => {
  const token = await ensureWebAccessToken();

  try {
    await axios.post(
      buildApiUrl('/api/users/logout'),
      {},
      {
        withCredentials: true,
        headers: {
          ...BROWSER_SESSION_HEADERS,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
  } catch (_error) {
    // Session cleanup on the client should continue even if the server session is already expired.
  } finally {
    clearWebAuthSession();
  }
};
