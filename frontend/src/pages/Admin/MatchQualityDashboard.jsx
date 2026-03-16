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
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const buildSparklinePoints = (trend = [], metricKey) => {
  if (!Array.isArray(trend) || trend.length === 0) return '';
  const width = 220;
  const height = 56;
  const step = trend.length > 1 ? width / (trend.length - 1) : width;

  return trend.map((row, index) => {
    const x = Math.round(index * step);
    const y = Math.round(height - clamp(Number(row?.[metricKey] || 0), 0, 1) * height);
    return `${x},${y}`;
  }).join(' ');
};

const MatchQualityDashboard = () => {
  const navigate = useNavigate();
  const [city, setCity] = useState('');
  const [roleCluster, setRoleCluster] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState(null);
  const [detail, setDetail] = useState(null);
  const [calibration, setCalibration] = useState(null);
  const [performanceAlerts, setPerformanceAlerts] = useState(null);

  const adminToken = useMemo(() => getAdminToken(), []);

  const authConfig = useMemo(() => ({
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
    params: {
      ...(city ? { city } : {}),
      ...(roleCluster ? { roleCluster } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    },
  }), [adminToken, city, roleCluster, from, to]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [overviewRes, detailRes, calibrationRes, alertsRes] = await Promise.all([
        axios.get(buildApiUrl('/api/admin/match-quality-overview'), authConfig),
        axios.get(buildApiUrl('/api/admin/match-quality-detail'), authConfig),
        axios.get(buildApiUrl('/api/admin/match-calibration-suggestions'), authConfig),
        axios.get(buildApiUrl('/api/admin/match-performance-alerts'), authConfig),
      ]);
      setOverview(overviewRes.data || {});
      setDetail(detailRes.data || {});
      setCalibration(calibrationRes.data?.data || null);
      setPerformanceAlerts(alertsRes.data?.data || null);
    } catch (loadError) {
      if ([401, 403].includes(loadError?.response?.status)) {
        clearAdminSession();
        navigate('/admin/login', { replace: true });
        return;
      }

      setError(loadError?.response?.data?.message || 'Failed to load match quality data');
    } finally {
      setLoading(false);
    }
  }, [authConfig, navigate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const buckets = detail?.matchProbabilityBuckets || {};
  const trends = performanceAlerts?.trends || [];
  const targets = performanceAlerts?.targets || {};
  const perfMetrics = performanceAlerts?.metrics || {};
  const perfAlerts = performanceAlerts?.alerts || [];
  const bucketRows = [
    { key: '>=0.85', label: 'STRONG (>=0.85)', color: '#10b981' },
    { key: '0.70-0.84', label: 'GOOD (0.70-0.84)', color: '#2563eb' },
    { key: '0.62-0.69', label: 'POSSIBLE (0.62-0.69)', color: '#f59e0b' },
  ];

  return (
    <AdminShell
      title="Match Quality Dashboard"
      subtitle="Monitor conversion quality, drift, and calibration suggestions."
    >
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>

        <div style={{ ...cardStyle, marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" style={{ padding: 10, borderRadius: 8, border: '1px solid #cbd5e1' }} />
          <input value={roleCluster} onChange={(e) => setRoleCluster(e.target.value)} placeholder="Role Cluster" style={{ padding: 10, borderRadius: 8, border: '1px solid #cbd5e1' }} />
          <input value={from} onChange={(e) => setFrom(e.target.value)} type="date" style={{ padding: 10, borderRadius: 8, border: '1px solid #cbd5e1' }} />
          <input value={to} onChange={(e) => setTo(e.target.value)} type="date" style={{ padding: 10, borderRadius: 8, border: '1px solid #cbd5e1' }} />
          <button onClick={loadData} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700 }}>Refresh</button>
        </div>

        {loading ? <p style={{ color: '#334155' }}>Loading...</p> : null}
        {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}

        {!loading && !error && (
          <>
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div style={cardStyle}><strong>Total Matches Served</strong><div>{overview?.totalMatchesServed || 0}</div></div>
              <div style={cardStyle}><strong>Avg Match Probability</strong><div>{formatPct(overview?.avgMatchProbability)}</div></div>
              <div style={cardStyle}><strong>Application Rate</strong><div>{formatPct(overview?.applicationRate)}</div></div>
              <div style={cardStyle}><strong>Shortlist Rate</strong><div>{formatPct(overview?.shortlistRate)}</div></div>
              <div style={cardStyle}><strong>Hire Rate</strong><div>{formatPct(overview?.hireRate)}</div></div>
              <div style={cardStyle}><strong>Retention 30d Rate</strong><div>{formatPct(overview?.retention30dRate)}</div></div>
            </div>

            <div style={{ marginTop: 16, ...cardStyle }}>
              <h3 style={{ marginTop: 0 }}>Benchmark Targets (7-Day Rolling)</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                {[
                  {
                    label: 'Interview Rate',
                    metricKey: 'interviewRate',
                    targetKey: 'interviewRateTarget',
                    color: '#2563eb',
                  },
                  {
                    label: 'Post-Interview Hire Rate',
                    metricKey: 'postInterviewHireRate',
                    targetKey: 'postInterviewHireRateTarget',
                    color: '#10b981',
                  },
                  {
                    label: 'Offer Acceptance Rate',
                    metricKey: 'offerAcceptanceRate',
                    targetKey: 'offerAcceptanceTarget',
                    color: '#f59e0b',
                  },
                ].map((item) => (
                  <div key={item.metricKey} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <strong>{item.label}</strong>
                      <span>{formatPct(perfMetrics?.[item.metricKey])} / {formatPct(targets?.[item.targetKey])}</span>
                    </div>
                    <svg width="220" height="56" viewBox="0 0 220 56" role="img" aria-label={`${item.label} trend`}>
                      <polyline
                        fill="none"
                        stroke={item.color}
                        strokeWidth="2"
                        points={buildSparklinePoints(trends, item.metricKey)}
                      />
                    </svg>
                    <div style={{ marginTop: 6, color: '#64748b', fontSize: 12 }}>
                      Sample: {item.metricKey === 'interviewRate'
                        ? perfMetrics?.counts?.matchesServed || 0
                        : item.metricKey === 'postInterviewHireRate'
                          ? perfMetrics?.counts?.interviewCount || 0
                          : perfMetrics?.counts?.offerDenominator || 0}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10 }}>
                <strong>Breaches</strong>
                <ul>
                  {perfAlerts.length > 0
                    ? perfAlerts.map((item) => (
                      <li key={item.metric}>
                        {item.label}: {formatPct(item.current)} below target {formatPct(item.target)} (severity: {item.severity})
                      </li>
                    ))
                    : <li>No benchmark breaches in current window.</li>}
                </ul>
              </div>
            </div>

            <div style={{ marginTop: 16, ...cardStyle }}>
              <h3 style={{ marginTop: 0 }}>Bucket Conversion Curves</h3>
              {bucketRows.map((bucket) => {
                const stats = buckets[bucket.key] || { apps: 0, shortlists: 0, hires: 0 };
                const hireRate = stats.apps > 0 ? stats.hires / stats.apps : 0;
                return (
                  <div key={bucket.key} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span>{bucket.label}</span>
                      <span>Apps {stats.apps} • Shortlists {stats.shortlists} • Hires {stats.hires}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 999, background: '#e2e8f0', marginTop: 6 }}>
                      <div style={{ width: `${Math.max(2, Math.round(hireRate * 100))}%`, height: 8, borderRadius: 999, background: bucket.color }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 16, ...cardStyle }}>
              <h3 style={{ marginTop: 0 }}>Calibration</h3>
              <p style={{ color: '#475569' }}>Model version: <strong>{calibration?.modelVersion || 'N/A'}</strong></p>
              {calibration?.driftDetected ? (
                <p style={{ color: '#b45309', fontWeight: 700 }}>Threshold drift alert detected</p>
              ) : (
                <p style={{ color: '#15803d', fontWeight: 700 }}>No severe drift detected</p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                <div style={{ background: '#f8fafc', borderRadius: 8, padding: 10 }}>
                  <strong>Current thresholds</strong>
                  <div>STRONG: {calibration?.currentThresholds?.strongMin ?? 'N/A'}</div>
                  <div>GOOD: {calibration?.currentThresholds?.goodMin ?? 'N/A'}</div>
                  <div>POSSIBLE: {calibration?.currentThresholds?.possibleMin ?? 'N/A'}</div>
                </div>
                <div style={{ background: '#f8fafc', borderRadius: 8, padding: 10 }}>
                  <strong>Suggested thresholds</strong>
                  <div>STRONG: {calibration?.suggestedThresholds?.strongMin ?? 'N/A'}</div>
                  <div>GOOD: {calibration?.suggestedThresholds?.goodMin ?? 'N/A'}</div>
                  <div>POSSIBLE: {calibration?.suggestedThresholds?.possibleMin ?? 'N/A'}</div>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <strong>Suggestions</strong>
                <ul>
                  {(calibration?.suggestions || []).length > 0
                    ? calibration.suggestions.map((item, idx) => <li key={`${idx}-${item}`}>{item}</li>)
                    : <li>No threshold adjustment suggested for current window.</li>}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
};

export default MatchQualityDashboard;
