import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const COLUMN_ORDER = ['Applied', 'Shortlisted', 'Interviewing', 'Offer', 'Hired'];
const COLUMN_TO_STATUS = {
    Applied: 'applied',
    Shortlisted: 'shortlisted',
    Interviewing: 'interview_requested',
    Offer: 'offer_sent',
    Hired: 'hired',
};

const STATUS_TO_COLUMN = {
    applied: 'Applied',
    shortlisted: 'Shortlisted',
    interview_requested: 'Interviewing',
    interview_completed: 'Interviewing',
    offer_sent: 'Offer',
    offer_accepted: 'Offer',
    offer_declined: 'Offer',
    hired: 'Hired',
    rejected: 'Applied',
    withdrawn: 'Applied',
    requested: 'Applied',
    pending: 'Applied',
    accepted: 'Interviewing',
    offer_proposed: 'Offer',
};

const TRANSITION_MAP = {
    applied: ['shortlisted', 'rejected', 'withdrawn'],
    shortlisted: ['interview_requested', 'rejected', 'withdrawn'],
    interview_requested: ['interview_completed', 'rejected', 'withdrawn'],
    interview_completed: ['offer_sent', 'interview_requested', 'rejected'],
    offer_sent: ['offer_accepted', 'offer_declined', 'rejected', 'withdrawn'],
    offer_accepted: ['hired'],
    offer_declined: ['rejected'],
    hired: [],
    rejected: [],
    withdrawn: [],
};

const LEGACY_ALIAS = {
    requested: 'applied',
    pending: 'applied',
    accepted: 'interview_requested',
    offer_proposed: 'offer_sent',
};

const normalizeStatus = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (LEGACY_ALIAS[normalized]) return LEGACY_ALIAS[normalized];
    return normalized;
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

const RecruiterApplications = () => {
    const [applications, setApplications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [draggedId, setDraggedId] = useState(null);
    const [updatingId, setUpdatingId] = useState(null);

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

    const grouped = useMemo(() => {
        const map = COLUMN_ORDER.reduce((acc, key) => ({ ...acc, [key]: [] }), {});
        for (const application of applications) {
            const status = normalizeStatus(application.status);
            const column = STATUS_TO_COLUMN[status] || 'Applied';
            map[column].push({
                ...application,
                normalizedStatus: status,
            });
        }
        return map;
    }, [applications]);

    const moveApplication = useCallback(async (applicationId, targetColumn) => {
        const application = applications.find((item) => String(item._id) === String(applicationId));
        if (!application) return;

        const currentStatus = normalizeStatus(application.status);
        const targetStatus = COLUMN_TO_STATUS[targetColumn];
        if (!targetStatus || currentStatus === targetStatus) return;

        const allowedTargets = TRANSITION_MAP[currentStatus] || [];
        if (!allowedTargets.includes(targetStatus)) {
            setError(`Illegal transition blocked: ${currentStatus} -> ${targetStatus}`);
            return;
        }

        const config = getAuthConfig();
        if (!config) {
            setError('Session expired. Please login again.');
            return;
        }

        try {
            setUpdatingId(String(applicationId));
            await axios.put(
                `/api/applications/${applicationId}/status`,
                { status: targetStatus },
                config
            );
            setApplications((prev) => prev.map((item) => (
                String(item._id) === String(applicationId)
                    ? { ...item, status: targetStatus }
                    : item
            )));
            setError('');
        } catch (updateError) {
            const message = updateError?.response?.data?.message || 'Failed to update application status';
            setError(message);
        } finally {
            setUpdatingId(null);
        }
    }, [applications]);

    const onDrop = (column) => {
        if (!draggedId) return;
        void moveApplication(draggedId, column);
        setDraggedId(null);
    };

    if (loading) {
        return <div className="p-6 text-sm text-gray-600">Loading hiring pipeline...</div>;
    }

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-6">
            <div className="mb-4 flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Workflow Dashboard</h1>
                    <p className="text-sm text-slate-600">Drag candidates across columns. Illegal moves are blocked by lifecycle rules.</p>
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

            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
                {COLUMN_ORDER.map((column) => (
                    <section
                        key={column}
                        className="min-h-[420px] rounded-xl border border-slate-200 bg-white p-3"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => onDrop(column)}
                    >
                        <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
                            <h2 className="text-sm font-semibold text-slate-800">{column}</h2>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                                {grouped[column].length}
                            </span>
                        </div>

                        <div className="space-y-2">
                            {grouped[column].map((application) => (
                                <article
                                    key={application._id}
                                    draggable={updatingId !== String(application._id)}
                                    onDragStart={() => setDraggedId(String(application._id))}
                                    className="cursor-move rounded-lg border border-slate-200 bg-slate-50 p-2 hover:border-slate-300"
                                >
                                    <p className="text-xs font-semibold text-slate-900">
                                        {application?.job?.title || 'Untitled role'}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-600">
                                        {application?.worker?.firstName || 'Candidate'} · {application?.job?.location || 'Unknown location'}
                                    </p>
                                    <p className="mt-2 text-[11px] uppercase tracking-wide text-slate-500">
                                        {application.normalizedStatus.replace(/_/g, ' ')}
                                    </p>
                                    {updatingId === String(application._id) ? (
                                        <p className="mt-1 text-[11px] text-indigo-600">Updating...</p>
                                    ) : null}
                                </article>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
};

export default RecruiterApplications;

