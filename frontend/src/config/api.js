const rawApiBaseUrl = String(process.env.REACT_APP_API_BASE_URL || '').trim();

export const API_BASE_URL = rawApiBaseUrl.replace(/\/$/, '');

export const buildApiUrl = (pathname = '') => {
    const normalizedPath = String(pathname || '').startsWith('/')
        ? String(pathname || '')
        : `/${String(pathname || '')}`;
    return API_BASE_URL ? `${API_BASE_URL}${normalizedPath}` : normalizedPath;
};
