let nextNoticeId = 1;
const listeners = new Set();

export const subscribeToNotices = (listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const publishNotice = (notice = {}) => {
  const payload = {
    id: `notice-${nextNoticeId++}`,
    type: 'info',
    title: '',
    message: '',
    durationMs: 5000,
    ...notice,
  };

  listeners.forEach((listener) => {
    listener(payload);
  });

  return payload.id;
};
