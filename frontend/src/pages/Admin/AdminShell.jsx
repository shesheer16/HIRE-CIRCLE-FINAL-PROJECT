import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { clearAdminSession, getAdminSession } from '../../utils/adminSession';

const shellStyle = {
  minHeight: '100vh',
  background: 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)',
  padding: 24,
};

const panelStyle = {
  maxWidth: 1280,
  margin: '0 auto',
};

const navLinkStyle = ({ isActive }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '10px 14px',
  borderRadius: 999,
  textDecoration: 'none',
  fontWeight: 700,
  color: isActive ? '#ffffff' : '#1e293b',
  background: isActive ? '#0f172a' : '#e2e8f0',
});

const AdminShell = ({ title, subtitle, children }) => {
  const navigate = useNavigate();
  const admin = getAdminSession()?.admin || null;

  const handleLogout = () => {
    clearAdminSession();
    navigate('/admin/login', { replace: true });
  };

  return (
    <div style={shellStyle}>
      <div style={panelStyle}>
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 18,
            padding: 20,
            boxShadow: '0 12px 30px rgba(15, 23, 42, 0.08)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              gap: 16,
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ color: '#475569', fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Platform Admin
              </div>
              <h1 style={{ margin: '6px 0 0', color: '#0f172a' }}>{title}</h1>
              <p style={{ color: '#475569', marginTop: 8, marginBottom: 0 }}>{subtitle}</p>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#0f172a', fontWeight: 700 }}>{admin?.name || 'Admin session'}</div>
              <div style={{ color: '#64748b', fontSize: 14 }}>{admin?.email || 'Authenticated'}</div>
              <button
                onClick={handleLogout}
                style={{
                  marginTop: 10,
                  border: 'none',
                  borderRadius: 999,
                  padding: '10px 14px',
                  background: '#fee2e2',
                  color: '#991b1b',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Sign Out
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18 }}>
            <NavLink to="/admin/match-quality" style={navLinkStyle}>
              Match Quality
            </NavLink>
            <NavLink to="/admin/market-control" style={navLinkStyle}>
              Market Control
            </NavLink>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default AdminShell;
