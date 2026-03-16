const ADMIN_SESSION_KEY = 'adminSession';

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
    if (!parsed?.token) {
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

  storage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
};

export const clearAdminSession = () => {
  const storage = getStorage();
  storage?.removeItem(ADMIN_SESSION_KEY);
};

export const getAdminToken = () => getAdminSession()?.token || '';

export const hasAdminSession = () => Boolean(getAdminToken());
