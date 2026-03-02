import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const PIPELINE_STEPS = ['Applied', 'Shortlisted', 'Interviewing', 'Offer', 'Hired'];
const LEGACY_ALIAS = {
    requested: 'applied',
    pending: 'applied',
    accepted: 'interview_requested',
    offer_proposed: 'offer_sent',
};

const STATUS_META = {
    applied: {
        label: 'Applied',
        nextAction: 'Wait for employer shortlist decision.',
        etaDays: 5,
        step: 0,
    },
    shortlisted: {
        label: 'Shortlisted',
        nextAction: 'Prepare for interview scheduling.',
        etaDays: 4,
        step: 1,
    },
    interview_requested: {
        label: 'Interview Requested',
        nextAction: 'Confirm interview schedule.',
        etaDays: 3,
        step: 2,
    },
    interview_completed: {
        label: 'Interview Completed',
        nextAction: 'Await employer decision.',
        etaDays: 3,
        step: 2,
    },
    offer_sent: {
        label: 'Offer Sent',
        nextAction: 'Review and respond before expiry.',
        etaDays: 7,
        step: 3,
    },
    offer_accepted: {
        label: 'Offer Accepted',
        nextAction: 'Complete onboarding and escrow steps.',
        etaDays: 2,
        step: 3,
    },
    offer_declined: {
        label: 'Offer Declined',
        nextAction: 'Application is closed.',
        etaDays: 0,
        step: 3,
    },
    hired: {
        label: 'Hired',
        nextAction: 'Begin work and onboarding.',
        etaDays: 0,
        step: 4,
    },
    rejected: {
        label: 'Rejected',
        nextAction: 'Application is closed.',
        etaDays: 0,
        step: 0,
    },
    withdrawn: {
        label: 'Withdrawn',
        nextAction: 'Application is closed.',
        etaDays: 0,
        step: 0,
    },
};

const normalizeStatus = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return LEGACY_ALIAS[normalized] || normalized;
};

const getAuthConfig = () => {
    const raw = localStorage.getItem('userInfo');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token) return null;
    return {
        headers: {
            Authorization: `Bearer ${parsed.token}`,
        },
    };
};

const CandidateApplications = () => {
    const [applications, setApplications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchApplications = useCallback(async () => {
        try {
            setLoading(true);
            const config = getAuthConfig();
            if (!config) {
                setError('Session expired. Please login again.');
                setApplications([]);
                return;
            }
            const { data } = await axios.get('/api/applications', config);
            const rows = Array.isArray(data?.data) ? data.data : [];
            setApplications(rows);
            setError('');
        } catch (_error) {
            setError('Failed to load applications.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchApplications();
    }, [fetchApplications]);

    const pipelineCounts = useMemo(() => {
        const counts = {
            Applied: 0,
            Shortlisted: 0,
            Interviewing: 0,
            Offer: 0,
            Hired: 0,
        };

        for (const row of applications) {
            const status = normalizeStatus(row.status);
            if (status === 'applied') counts.Applied += 1;
            else if (status === 'shortlisted') counts.Shortlisted += 1;
            else if (['interview_requested', 'interview_completed'].includes(status)) counts.Interviewing += 1;
            else if (['offer_sent', 'offer_accepted', 'offer_declined'].includes(status)) counts.Offer += 1;
            else if (status === 'hired') counts.Hired += 1;
        }
        return counts;
    }, [applications]);

    if (loading) {
        return <div className="p-6 text-sm text-gray-600">Loading application timeline...</div>;
    }

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-6">
            <div className="mb-4 flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">My Applications Pipeline</h1>
                    <p className="text-sm text-slate-600">Track each application stage, next action, and expected timeline.</p>
                </div>
                <button
                    type="button"
                    onClick={() => fetchApplications()}
                    className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                    Refresh
                </button>
            </div>

            {error ? (
                <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                </div>
            ) : null}

            <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-5">
                {PIPELINE_STEPS.map((step) => (
                    <div key={step} className="rounded-lg border border-slate-200 bg-white p-3">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">{step}</p>
                        <p className="mt-1 text-xl font-semibold text-slate-900">{pipelineCounts[step]}</p>
                    </div>
                ))}
            </div>

            <div className="space-y-3">
                {applications.map((row) => {
                    const status = normalizeStatus(row.status);
                    const meta = STATUS_META[status] || STATUS_META.applied;
                    const progressPct = Math.max(0, Math.min(100, (meta.step / (PIPELINE_STEPS.length - 1)) * 100));

                    return (
                        <article key={row._id} className="rounded-xl border border-slate-200 bg-white p-4">
                            <div className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
                                <div>
                                    <p className="text-sm font-semibold text-slate-900">{row?.job?.title || 'Untitled role'}</p>
                                    <p className="text-xs text-slate-600">{row?.job?.companyName || 'Unknown employer'} · {row?.job?.location || 'Unknown location'}</p>
                                </div>
                                <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                                    {meta.label}
                                </span>
                            </div>

                            <div className="mt-3 h-2 w-full rounded-full bg-slate-100">
                                <div
                                    className="h-2 rounded-full bg-emerald-500 transition-all"
                                    style={{ width: `${progressPct}%` }}
                                />
                            </div>

                            <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-600 md:grid-cols-3">
                                <div>
                                    <p className="font-semibold text-slate-700">Current Stage</p>
                                    <p>{meta.label}</p>
                                </div>
                                <div>
                                    <p className="font-semibold text-slate-700">Next Action</p>
                                    <p>{meta.nextAction}</p>
                                </div>
                                <div>
                                    <p className="font-semibold text-slate-700">Estimated Timeline</p>
                                    <p>{meta.etaDays > 0 ? `${meta.etaDays} day(s)` : 'Complete/Closed'}</p>
                                </div>
                            </div>
                        </article>
                    );
                })}
            </div>

            {applications.length === 0 ? (
                <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                    No applications yet.
                </div>
            ) : null}
        </div>
    );
};

export default CandidateApplications;

