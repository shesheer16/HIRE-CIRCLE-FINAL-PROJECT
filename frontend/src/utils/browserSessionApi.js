import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import {
  clearWebAuthSession,
  ensureWebAccessToken,
  LOGIN_NOTICE_QUERY_PARAM,
  LOGIN_NOTICE_SESSION_EXPIRED,
} from './webAuthSession';
import { publishNotice } from './noticeBus';

const browserSessionApi = axios.create({
  baseURL: API_BASE_URL || undefined,
  withCredentials: true,
  headers: {
    'X-Session-Mode': 'browser',
  },
});

let redirectInFlight = false;

const isAuthFailure = (error) => {
  const status = Number(error?.response?.status || 0);
  const message = String(error?.response?.data?.message || '').trim().toLowerCase();
  const code = String(error?.response?.data?.code || '').trim().toUpperCase();

  if (status === 401) {
    return true;
  }

  if (status !== 403) {
    return false;
  }

  if (code === 'OTP_NOT_VERIFIED') {
    return true;
  }

  return [
    'not authorized',
    'token failed',
    'account is banned',
    'account verification is required',
    'otp verification required',
  ].some((fragment) => message.includes(fragment));
};

const redirectToLogin = () => {
  if (typeof window === 'undefined' || redirectInFlight) {
    return;
  }

  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (currentPath.startsWith('/login')) {
    return;
  }

  redirectInFlight = true;
  const params = new URLSearchParams();
  if (currentPath && currentPath !== '/') {
    params.set('redirect', currentPath);
  }
  params.set(LOGIN_NOTICE_QUERY_PARAM, LOGIN_NOTICE_SESSION_EXPIRED);
  const query = params.toString();
  window.location.replace(query ? `/login?${query}` : '/login');
};

const shouldPublishGlobalErrorNotice = (error) => {
  const config = error?.config || {};
  if (config.suppressGlobalErrorNotice === true) {
    return false;
  }

  if (config.showGlobalErrorNotice === true) {
    return true;
  }

  const method = String(config.method || '').trim().toLowerCase();
  return method && method !== 'get';
};

const resolveGlobalErrorMessage = (error) => {
  const responseMessage = String(error?.response?.data?.message || '').trim();
  if (responseMessage) {
    return responseMessage;
  }

  const fallback = String(error?.message || '').trim();
  return fallback || 'Something went wrong. Please try again.';
};

browserSessionApi.interceptors.request.use(async (config) => {
  const token = await ensureWebAccessToken();
  if (!token) {
    clearWebAuthSession();
    redirectToLogin();
    return Promise.reject(new Error('Session expired'));
  }

  return {
    ...config,
    withCredentials: true,
    headers: {
      ...(config.headers || {}),
      'X-Session-Mode': 'browser',
      Authorization: `Bearer ${token}`,
    },
  };
});

browserSessionApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (isAuthFailure(error)) {
      clearWebAuthSession();
      redirectToLogin();
    } else if (shouldPublishGlobalErrorNotice(error)) {
      publishNotice({
        type: 'error',
        title: 'Request failed',
        message: resolveGlobalErrorMessage(error),
      });
    }

    return Promise.reject(error);
  }
);

export default browserSessionApi;
