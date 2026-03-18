const ADMIN_SESSION_KEY = 'adminSession';

let adminMemoryToken = '';

const getStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage;
};

export const getAdminSession = () => {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(ADMIN_SESSION_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!adminMemoryToken) {
      storage.removeItem(ADMIN_SESSION_KEY);
      return null;
    }

    return parsed;
  } catch (error) {
    storage.removeItem(ADMIN_SESSION_KEY);
    return null;
  }
};

export const setAdminSession = (session) => {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const { token, ...metadata } = session || {};
  if (token) {
    adminMemoryToken = token;
  }

  storage.setItem(ADMIN_SESSION_KEY, JSON.stringify(metadata));
};

export const clearAdminSession = () => {
  adminMemoryToken = '';
  const storage = getStorage();
  storage?.removeItem(ADMIN_SESSION_KEY);
};

export const getAdminToken = () => adminMemoryToken || '';

export const hasAdminSession = () => Boolean(getAdminToken());
