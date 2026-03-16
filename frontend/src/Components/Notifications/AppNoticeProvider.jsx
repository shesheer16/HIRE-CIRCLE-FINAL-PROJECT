import React, { useEffect, useRef, useState } from 'react';
import { subscribeToNotices } from '../../utils/noticeBus';

const toneStyles = {
  info: {
    background: '#eff6ff',
    border: '#bfdbfe',
    title: '#1d4ed8',
    message: '#1e3a8a',
  },
  success: {
    background: '#ecfdf5',
    border: '#a7f3d0',
    title: '#047857',
    message: '#065f46',
  },
  error: {
    background: '#fff1f2',
    border: '#fecdd3',
    title: '#be123c',
    message: '#881337',
  },
};

const AppNoticeProvider = ({ children }) => {
  const [notices, setNotices] = useState([]);
  const timersRef = useRef(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    const unsubscribe = subscribeToNotices((notice) => {
      setNotices((current) => [...current, notice].slice(-4));

      if (Number(notice.durationMs) > 0) {
        const timeoutId = window.setTimeout(() => {
          setNotices((current) => current.filter((entry) => entry.id !== notice.id));
          timers.delete(notice.id);
        }, Number(notice.durationMs));
        timers.set(notice.id, timeoutId);
      }
    });

    return () => {
      unsubscribe();
      timers.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timers.clear();
    };
  }, []);

  const dismissNotice = (noticeId) => {
    const timeoutId = timersRef.current.get(noticeId);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timersRef.current.delete(noticeId);
    }

    setNotices((current) => current.filter((entry) => entry.id !== noticeId));
  };

  return (
    <>
      {children}
      <div
        style={{
          position: 'fixed',
          top: 18,
          right: 18,
          zIndex: 5000,
          display: 'grid',
          gap: 10,
          width: 'min(360px, calc(100vw - 24px))',
          pointerEvents: 'none',
        }}
      >
        {notices.map((notice) => {
          const tone = toneStyles[notice.type] || toneStyles.info;
          return (
            <div
              key={notice.id}
              style={{
                pointerEvents: 'auto',
                borderRadius: 16,
                border: `1px solid ${tone.border}`,
                background: tone.background,
                boxShadow: '0 18px 40px rgba(15, 23, 42, 0.12)',
                padding: '14px 16px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div>
                  {notice.title ? (
                    <div style={{ color: tone.title, fontWeight: 800, marginBottom: notice.message ? 4 : 0 }}>
                      {notice.title}
                    </div>
                  ) : null}
                  {notice.message ? (
                    <div style={{ color: tone.message, lineHeight: 1.45, fontSize: 14 }}>
                      {notice.message}
                    </div>
                  ) : null}
                </div>
                <button
                  onClick={() => dismissNotice(notice.id)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: tone.title,
                    cursor: 'pointer',
                    fontWeight: 800,
                    fontSize: 16,
                    lineHeight: 1,
                  }}
                  aria-label="Dismiss notification"
                >
                  x
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

export default AppNoticeProvider;
