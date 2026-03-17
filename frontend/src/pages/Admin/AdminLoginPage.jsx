import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import { buildApiUrl } from '../../config/api';
import { hasAdminSession, setAdminSession } from '../../utils/adminSession';

const pageStyle = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  background: 'radial-gradient(circle at top, #dbeafe 0%, #eff6ff 38%, #f8fafc 100%)',
};

const cardStyle = {
  width: '100%',
  maxWidth: 420,
  background: '#ffffff',
  border: '1px solid #dbeafe',
  borderRadius: 22,
  padding: 28,
  boxShadow: '0 20px 50px rgba(15, 23, 42, 0.12)',
};

const inputStyle = {
  width: '100%',
  border: '1px solid #cbd5e1',
  borderRadius: 12,
  padding: '12px 14px',
  fontSize: 15,
  boxSizing: 'border-box',
};

const AdminLoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const redirectPath = location.state?.from?.pathname || '/admin/match-quality';

  useEffect(() => {
    if (hasAdminSession()) {
      navigate(redirectPath, { replace: true });
    }
  }, [navigate, redirectPath]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
    setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { data } = await axios.post(
        buildApiUrl('/api/admin/auth/login'),
        formData,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      setAdminSession(data);
      navigate(redirectPath, { replace: true });
    } catch (loginError) {
      setError(loginError?.response?.data?.message || 'Admin login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ color: '#1d4ed8', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 13 }}>
          Protected Access
        </div>
        <h1 style={{ margin: '10px 0 0', color: '#0f172a' }}>Platform admin login</h1>
        <p style={{ marginTop: 10, color: '#475569', lineHeight: 1.5 }}>
          Use your platform admin credentials to access operational dashboards. This session is kept in browser session storage and ends on sign out or tab close.
        </p>

        {error ? (
          <div
            style={{
              marginTop: 16,
              borderRadius: 12,
              padding: '12px 14px',
              background: '#fee2e2',
              color: '#991b1b',
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} style={{ marginTop: 20 }}>
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="email" style={{ display: 'block', marginBottom: 8, color: '#334155', fontWeight: 600 }}>
              Admin email
            </label>
            <input
              id="email"
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              autoComplete="username"
              required
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label htmlFor="password" style={{ display: 'block', marginBottom: 8, color: '#334155', fontWeight: 600 }}>
              Password
            </label>
            <input
              id="password"
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              autoComplete="current-password"
              required
              style={inputStyle}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              border: 'none',
              borderRadius: 12,
              padding: '13px 14px',
              background: '#0f172a',
              color: '#ffffff',
              fontWeight: 700,
              cursor: loading ? 'progress' : 'pointer',
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AdminLoginPage;
