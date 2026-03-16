import React, { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import {
  ensureWebAccessToken,
  getWebSession,
  resolveWebHomePath,
} from '../../utils/webAuthSession';

const normalizeRole = (value) => String(value || '').trim().toLowerCase();

const RequireWebSession = ({ allowedRoles = [], children }) => {
  const location = useLocation();
  const [status, setStatus] = useState('checking');
  const [session, setSession] = useState(() => getWebSession());

  useEffect(() => {
    let active = true;

    const verifySession = async () => {
      const token = await ensureWebAccessToken();
      if (!active) {
        return;
      }

      if (!token) {
        setSession(null);
        setStatus('unauthenticated');
        return;
      }

      const currentSession = getWebSession();
      setSession(currentSession);
      setStatus(currentSession ? 'ready' : 'unauthenticated');
    };

    verifySession();

    return () => {
      active = false;
    };
  }, [location.pathname]);

  if (status === 'checking') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          color: '#334155',
          fontWeight: 600,
        }}
      >
        Restoring your session...
      </div>
    );
  }

  if (status !== 'ready' || !session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (allowedRoles.length > 0) {
    const allowed = allowedRoles.map(normalizeRole);
    const currentRole = normalizeRole(session.role);
    if (!allowed.includes(currentRole)) {
      return <Navigate to={resolveWebHomePath(session)} replace />;
    }
  }

  return children || <Outlet />;
};

export default RequireWebSession;
