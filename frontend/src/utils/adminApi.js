import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { clearAdminSession, getAdminToken } from './adminSession';

const adminApi = axios.create({
  baseURL: API_BASE_URL || undefined,
  withCredentials: true,
});

adminApi.interceptors.request.use((config) => {
  const token = getAdminToken();

  return {
    ...config,
    withCredentials: true,
    headers: {
      ...(config.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
});

adminApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = Number(error?.response?.status || 0);

    if (status === 401 || status === 403) {
      clearAdminSession();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/admin/login')) {
        window.location.replace('/admin/login');
      }
    }

    return Promise.reject(error);
  }
);

export default adminApi;
