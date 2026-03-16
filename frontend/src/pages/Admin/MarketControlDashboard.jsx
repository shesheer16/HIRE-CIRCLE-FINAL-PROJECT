import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import AdminShell from './AdminShell';
import { buildApiUrl } from '../../config/api';
import { clearAdminSession, getAdminToken } from '../../utils/adminSession';

const cardStyle = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 14,
  padding: 16,
  boxShadow: '0 2px 8px rgba(15, 23, 42, 0.05)',
};

const formatPct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;
const formatInr = (value) => `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;

const liquidityColor = (workersPerJob) => {
  const ratio = Number(workersPerJob || 0);
  if (ratio < 2) return '#dc2626';
  if (ratio > 6) return '#f59e0b';
  return '#16a34a';
};

const MarketControlDashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState([]);

  const adminToken = useMemo(() => getAdminToken(), []);

  const authConfig = useMemo(() => ({
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  }), [adminToken]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [marketRes, alertsRes] = await Promise.all([
        axios.get(buildApiUrl('/api/admin/market-control'), authConfig),
        axios.get(buildApiUrl('/api/admin/market-alerts'), authConfig),
      ]);

      setData(marketRes.data?.data || null);
      setAlerts(alertsRes.data?.data || []);
    } catch (loadError) {
      if ([401, 403].includes(loadError?.response?.status)) {
        clearAdminSession();
        navigate('/admin/login', { replace: true });
        return;
      }

      setError(loadError?.response?.data?.message || 'Failed to load market control data');
    } finally {
      setLoading(false);
    }
  }, [authConfig, navigate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const cityLiquidity = data?.cityLiquidity || [];
  const tierDistribution = data?.tierDistribution || [];
  const revenuePerCity = data?.revenuePerCity || [];
  const expansionReadiness = data?.expansionReadiness || [];

  const topRevenue = revenuePerCity[0]?.revenueInr || 0;
  const readyCities = expansionReadiness.filter((row) => row.readinessStatus === 'READY_FOR_SCALE').length;
  const underSuppliedCities = cityLiquidity.filter((row) => row.marketBand === 'under_supplied').length;

  return (
    <AdminShell
      title="Market Control Dashboard"
      subtitle="City liquidity, expansion readiness, employer tiering, and market anomalies."
    >
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>

        <div style={{ ...cardStyle, marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#64748b' }}>Generated: {data?.generatedAt || '--'}</div>
          <button onClick={loadData} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 14px', fontWeight: 700 }}>
            Refresh
          </button>
        </div>

        {loading ? <p style={{ color: '#334155' }}>Loading...</p> : null}
        {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}

        {!loading && !error && (
          <>
            <div style={{ marginTop: 16, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <div style={cardStyle}><strong>Cities Tracked</strong><div>{cityLiquidity.length}</div></div>
              <div style={cardStyle}><strong>Under-supplied Cities</strong><div>{underSuppliedCities}</div></div>
              <div style={cardStyle}><strong>READY_FOR_SCALE Cities</strong><div>{readyCities}</div></div>
              <div style={cardStyle}><strong>Top City Revenue (30d)</strong><div>{formatInr(topRevenue)}</div></div>
            </div>

            <div style={{ marginTop: 16, ...cardStyle }}>
              <h3 style={{ marginTop: 0 }}>City Liquidity Heatmap</h3>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                {cityLiquidity.map((row) => (
                  <div
                    key={row.city}
                    style={{
                      borderRadius: 10,
                      padding: 12,
                      border: `1px solid ${liquidityColor(row.workersPerJob)}`,
                      background: '#ffffff',
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{row.city}</div>
                    <div style={{ color: '#475569', fontSize: 13 }}>Workers/Job: {row.workersPerJob}</div>
                    <div style={{ color: '#475569', fontSize: 13 }}>Fill Rate: {formatPct(row.fillRate)}</div>
                    <div style={{ color: '#475569', fontSize: 13 }}>Band: {row.marketBand}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 16, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
              <div style={cardStyle}>
                <h3 style={{ marginTop: 0 }}>Employer Tier Distribution</h3>
                <ul>
                  {tierDistribution.length
                    ? tierDistribution.map((row) => (
                      <li key={row.tier}>
                        {row.tier}: {row.count} ({formatPct(row.share)})
                      </li>
                    ))
                    : <li>No tier data</li>}
                </ul>
              </div>

              <div style={cardStyle}>
                <h3 style={{ marginTop: 0 }}>Revenue Per City (30d)</h3>
                <ul>
                  {revenuePerCity.length
                    ? revenuePerCity.slice(0, 8).map((row) => (
                      <li key={row.city}>{row.city}: {formatInr(row.revenueInr)}</li>
                    ))
                    : <li>No revenue data</li>}
                </ul>
              </div>
            </div>

            <div style={{ marginTop: 16, ...cardStyle }}>
              <h3 style={{ marginTop: 0 }}>Expansion Readiness</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '8px 6px' }}>City</th>
                    <th style={{ padding: '8px 6px' }}>Readiness Score</th>
                    <th style={{ padding: '8px 6px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {expansionReadiness.map((row) => (
                    <tr key={row.city} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 6px' }}>{row.city}</td>
                      <td style={{ padding: '8px 6px' }}>{formatPct(row.expansionReadinessScore)}</td>
                      <td style={{ padding: '8px 6px' }}>{row.readinessStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 16, ...cardStyle }}>
              <h3 style={{ marginTop: 0 }}>Market Alerts</h3>
              <ul>
                {alerts.length
                  ? alerts.slice(0, 15).map((row) => (
                    <li key={row._id}>
                      [{row.severity}] {row.type} - {row.message}
                    </li>
                  ))
                  : <li>No active market anomalies</li>}
              </ul>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
};

export default MarketControlDashboard;
