/**
 * usePulseData.js
 * Domain hook: Pulse tab — live radar, gig applications, nearby pros, pulse animations.
 * Shared deps: showPulseToast, isEmployerRole, resolveWorkerApplicationIdentity
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../../api/client';
import {
    CONNECT_READ_TIMEOUT_MS,
    isDemoRecord,
    timeAgo,
} from './connectUtils';
import {
    SCREENSHOT_MOCKS_ENABLED,
    SCREENSHOT_PULSE_APPLIED_IDS,
    SCREENSHOT_PULSE_ITEMS,
    SCREENSHOT_PULSE_NEARBY_PROS,
} from '../../config/screenshotMocks';

const PULSE_CACHE_KEY = '@pulse_cache_v1';

/**
 * @param {object} params
 * @param {boolean} params.isEmployerRole
 * @param {function} params.showPulseToast
 * @param {function} params.resolveWorkerApplicationIdentity
 * @param {function} params.openJobPreviewFromPost  — shared handler from useFeedData
 */
export function usePulseData({
    isEmployerRole,
    showPulseToast,
    resolveWorkerApplicationIdentity,
    openJobPreviewFromPost,
}) {
    const [pulseItems, setPulseItems] = useState([]);
    const [nearbyPros, setNearbyPros] = useState([]);
    const [appliedGigIds, setAppliedGigIds] = useState(new Set());
    const [hiredProIds, setHiredProIds] = useState(new Set());
    const [radarRefreshing, setRadarRefreshing] = useState(false);
    const [pulseLoading, setPulseLoading] = useState(true);
    const [pulseError, setPulseError] = useState('');
    const [nearbyProsError, setNearbyProsError] = useState('');
    const pulseAnim = useRef(new Animated.Value(0.3)).current;
    const pulseLoopRef = useRef(null);
    const pulseFetchRequestIdRef = useRef(0);
    const nearbyProsAutoLoadedRef = useRef(false);
    const pulseItemsLengthRef = useRef(0);
    const pulseCachePrimedRef = useRef(false);

    const applyScreenshotMocks = useCallback(() => {
        if (!SCREENSHOT_MOCKS_ENABLED) return;
        setPulseItems(SCREENSHOT_PULSE_ITEMS);
        setAppliedGigIds(new Set(SCREENSHOT_PULSE_APPLIED_IDS));
        setPulseLoading(false);
        setPulseError('');
        setRadarRefreshing(false);
        if (isEmployerRole) {
            setNearbyPros(SCREENSHOT_PULSE_NEARBY_PROS);
        }
    }, [isEmployerRole]);

    // Keep ref in sync to avoid stale closure in fetchPulseItems
    useEffect(() => { pulseItemsLengthRef.current = pulseItems.length; }, [pulseItems.length]);

    const primePulseFromCache = useCallback(async () => {
        if (pulseCachePrimedRef.current) return;
        pulseCachePrimedRef.current = true;
        try {
            const cachedRaw = await AsyncStorage.getItem(PULSE_CACHE_KEY);
            if (!cachedRaw) return;
            const parsed = JSON.parse(cachedRaw);
            if (Array.isArray(parsed) && parsed.length) {
                setPulseItems(parsed.filter((item) => item && typeof item === 'object'));
                setPulseLoading(false);
            }
        } catch (_error) {
            // ignore cache failures; network fetch will continue
        }
    }, []);

    const fetchPulseItems = useCallback(async () => {
        if (SCREENSHOT_MOCKS_ENABLED) {
            applyScreenshotMocks();
            return;
        }
        const shouldShowLoading = pulseItems.length === 0;
        if (shouldShowLoading) setPulseLoading(true);
        setPulseError('');
        const requestId = pulseFetchRequestIdRef.current + 1;
        pulseFetchRequestIdRef.current = requestId;
        if (shouldShowLoading) { primePulseFromCache(); }

        try {
            const { data } = await client.get('/api/pulse', {
                timeout: CONNECT_READ_TIMEOUT_MS,
                __maxRetries: 2,
                __skipApiErrorHandler: true,
            });
            if (requestId !== pulseFetchRequestIdRef.current) return;

            const items = Array.isArray(data?.items)
                ? data.items.filter((item) => item && typeof item === 'object' && !isDemoRecord(item))
                : [];
            const seen = new Set();
            const hasServerPulseRanking = items.some((item) => Number.isFinite(Number(item?.pulseRank)));

            const mapped = items
                .map((item) => ({
                    id: item.id || item._id,
                    rawJobId: item.jobId,
                    rawPostType: item.postType,
                    rawCanApply: item.canApply,
                    createdAt: item.createdAt || item.timePosted || null,
                    interactionCount: Number(item.interactionCount || 0),
                    engagementScore: Number(item.engagementScore || 0),
                    pulseRank: Number(item.pulseRank || 0),
                    localityTier: Number(item.localityTier || 0),
                    rawTimePosted: item.timePosted,
                    rawCategory: item.category,
                    rawEmployer: item.employer,
                    rawCompanyName: item.companyName,
                    rawTitle: item.title,
                    rawContent: item.content,
                    rawDistance: item.distance,
                    rawLocation: item.location,
                    rawDistrict: item.district,
                    rawMandal: item.mandal,
                    rawLocationLabel: item.locationLabel,
                    rawPay: item.pay,
                    rawSalaryRange: item.salaryRange,
                    rawUrgent: item.urgent,
                    rawIsPulse: item.isPulse,
                    rawRequirements: item.requirements,
                }))
                .filter((item) => {
                    const id = String(item.id || '').trim();
                    if (!id || seen.has(id)) return false;
                    seen.add(id);
                    return true;
                })
                .sort((left, right) => {
                    if (hasServerPulseRanking) {
                        if (right.pulseRank !== left.pulseRank) return right.pulseRank - left.pulseRank;
                        if (right.localityTier !== left.localityTier) return right.localityTier - left.localityTier;
                    }
                    const leftScore = Number(left.engagementScore || 0);
                    const rightScore = Number(right.engagementScore || 0);
                    if (rightScore !== leftScore) return rightScore - leftScore;
                    const leftTs = new Date(left.createdAt || 0).getTime();
                    const rightTs = new Date(right.createdAt || 0).getTime();
                    if (rightTs !== leftTs) return rightTs - leftTs;
                    if (right.interactionCount !== left.interactionCount) return right.interactionCount - left.interactionCount;
                    return String(left.id).localeCompare(String(right.id));
                })
                .map((item) => ({
                    id: item.id,
                    jobId: String(item.rawJobId || (String(item.rawPostType || '').toLowerCase() === 'job' ? item.id : '') || '').trim(),
                    title: item.rawTitle || item.rawContent || 'Urgent Requirement',
                    employer: item.rawEmployer || item.rawCompanyName || 'Employer',
                    companyName: item.rawCompanyName || item.rawEmployer || 'Employer',
                    distance: item.rawDistance || item.rawLocationLabel || item.rawLocation || 'Nearby',
                    location: item.rawLocationLabel || item.rawLocation || item.rawDistance || 'Nearby',
                    district: String(item.rawDistrict || '').trim(),
                    mandal: String(item.rawMandal || '').trim(),
                    pay: item.rawPay || item.rawSalaryRange || 'Negotiable',
                    urgent: Boolean(item.rawUrgent || item.rawIsPulse),
                    timePosted: timeAgo(item.createdAt || item.rawTimePosted),
                    category: item.rawCategory || item.rawRequirements?.[0] || 'Pulse',
                    categoryBg: '#fef3c7',
                    categoryColor: '#b45309',
                    postType: String(item.rawPostType || 'status').toLowerCase(),
                    canApply: Boolean(item.rawCanApply) || String(item.rawPostType || '').toLowerCase() === 'job',
                    pulseRank: item.pulseRank,
                    localityTier: item.localityTier,
                    requirements: Array.isArray(item.rawRequirements)
                        ? item.rawRequirements.filter((entry) => typeof entry === 'string' && entry.trim())
                        : [],
                    description: String(item.rawContent || item.rawTitle || '').trim(),
                    createdAt: item.createdAt || null,
                }));

            setPulseItems(mapped);
            AsyncStorage.setItem(PULSE_CACHE_KEY, JSON.stringify(mapped.slice(0, 40))).catch(() => {});
            setPulseError('');
            if (shouldShowLoading) setPulseLoading(false);
        } catch (_error) {
            if (requestId !== pulseFetchRequestIdRef.current) return;
            try {
                const cachedRaw = await AsyncStorage.getItem(PULSE_CACHE_KEY);
                const cached = cachedRaw ? JSON.parse(cachedRaw) : [];
                if (Array.isArray(cached) && cached.length) {
                    setPulseItems(cached.filter((item) => item && typeof item === 'object'));
                    setPulseError('Showing saved radar — pull to refresh.');
                } else if (pulseItemsLengthRef.current > 0) {
                    setPulseError('Showing your last radar — pull to refresh.');
                } else {
                    setPulseError('No live gigs to show yet.');
                }
            } catch (_cacheError) {
                setPulseError('No live gigs to show yet.');
            }
            if (shouldShowLoading) setPulseLoading(false);
        }
    }, [primePulseFromCache]);

    const fetchNearbyPros = useCallback(async () => {
        if (SCREENSHOT_MOCKS_ENABLED) {
            setNearbyPros(SCREENSHOT_PULSE_NEARBY_PROS);
            setNearbyProsError('');
            return;
        }
        if (!isEmployerRole) {
            setNearbyPros([]);
            setNearbyProsError('');
            return;
        }
        setNearbyProsError('');
        try {
            const jobsResponse = await client.get('/api/jobs/my-jobs', {
                __skipApiErrorHandler: true,
                timeout: CONNECT_READ_TIMEOUT_MS,
                __maxRetries: 1,
            });
            const jobs = Array.isArray(jobsResponse?.data)
                ? jobsResponse.data
                : (Array.isArray(jobsResponse?.data?.data) ? jobsResponse.data.data : []);
            const safeJobs = jobs
                .filter((job) => (
                    job && typeof job === 'object'
                    && String(job?._id || '').trim()
                    && !isDemoRecord(job)
                ))
                .slice(0, 3);

            if (!safeJobs.length) {
                setNearbyPros([]);
                setNearbyProsError('');
                return;
            }

            const matchResponses = await Promise.all(
                safeJobs.map(async (job) => {
                    try {
                        const response = await client.get(`/api/matches/employer/${String(job._id).trim()}`, {
                            __skipApiErrorHandler: true,
                            timeout: CONNECT_READ_TIMEOUT_MS,
                            __maxRetries: 1,
                        });
                        return { job, response };
                    } catch (_error) {
                        return { job, response: null };
                    }
                })
            );

            const candidateRows = [];
            matchResponses.forEach(({ job, response }) => {
                const matches = Array.isArray(response?.data?.matches) ? response.data.matches : [];
                matches.forEach((item) => {
                    const worker = item?.worker || {};
                    const workerId = String(worker?._id || '').trim();
                    if (!workerId || isDemoRecord(worker)) return;
                    const firstRole = Array.isArray(worker?.roleProfiles) && worker.roleProfiles.length > 0
                        ? worker.roleProfiles[0] : {};
                    const workerName = String(
                        worker?.user?.name || worker?.firstName
                        || [worker?.firstName, worker?.lastName].filter(Boolean).join(' ')
                        || 'Professional'
                    ).trim();
                    candidateRows.push({
                        id: `${String(job?._id || '')}:${workerId}`,
                        workerId,
                        jobId: String(job?._id || '').trim(),
                        name: workerName || 'Professional',
                        role: String(firstRole?.roleName || item?.tier || 'Job Seeker').trim() || 'Job Seeker',
                        distance: String(worker?.city || job?.location || 'Nearby').trim() || 'Nearby',
                        karma: String(Math.round(Number(item?.trustScore || item?.matchScore || 0))),
                        available: worker?.isAvailable !== false,
                        avatar: String(worker?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(workerName || 'Professional')}&background=8b3dff&color=fff&rounded=true`),
                        predictedHireProbability: Number(item?.predictedHireProbability || 0),
                        matchScore: Number(item?.matchScore || 0),
                        jobTitle: String(job?.title || 'Open role'),
                    });
                });
            });

            const byWorker = new Map();
            candidateRows.forEach((row) => {
                const key = String(row.workerId || '').trim();
                if (!key) return;
                if (!byWorker.has(key)) { byWorker.set(key, row); return; }
                const existing = byWorker.get(key);
                const nextScore = Number(row?.predictedHireProbability || 0) + Number(row?.matchScore || 0) / 100;
                const existingScore = Number(existing?.predictedHireProbability || 0) + Number(existing?.matchScore || 0) / 100;
                if (nextScore > existingScore) byWorker.set(key, row);
            });

            const ranked = Array.from(byWorker.values())
                .sort((left, right) => {
                    const probDiff = Number(right?.predictedHireProbability || 0) - Number(left?.predictedHireProbability || 0);
                    if (probDiff !== 0) return probDiff;
                    const matchDiff = Number(right?.matchScore || 0) - Number(left?.matchScore || 0);
                    if (matchDiff !== 0) return matchDiff;
                    return String(left?.workerId || '').localeCompare(String(right?.workerId || ''));
                })
                .slice(0, 20);

            setNearbyPros(ranked);
            setNearbyProsError('');
        } catch (_error) {
            setNearbyPros([]);
            setNearbyProsError('Nearby job seeker matches could not load right now.');
        }
    }, [isEmployerRole]);

    const handleRefreshRadar = useCallback(async () => {
        setRadarRefreshing(true);
        await Promise.all([fetchPulseItems(), fetchNearbyPros()]);
        setRadarRefreshing(false);
    }, [fetchNearbyPros, fetchPulseItems]);

    const handleApplyGig = useCallback(async (gig) => {
        const jobId = String(gig?.jobId || gig?.id || '').trim();
        const employerName = String(gig?.employer || 'Employer').trim() || 'Employer';
        if (!jobId) { showPulseToast('This post cannot be applied from Pulse.'); return; }
        if (isEmployerRole) { showPulseToast('Switch to Job Seeker role to apply for gigs.'); return; }
        try {
            const workerId = await resolveWorkerApplicationIdentity();
            if (!workerId) { showPulseToast('Complete your worker profile before applying.'); return; }
            await client.post('/api/applications', { jobId, workerId, initiatedBy: 'worker' }, { __skipApiErrorHandler: true });
            setAppliedGigIds((prev) => new Set(prev).add(jobId));
            showPulseToast(`Request sent to ${employerName}!`);
        } catch (error) {
            const message = String(error?.response?.data?.message || '').trim();
            showPulseToast(message || 'Could not apply right now. Please retry.');
        }
    }, [isEmployerRole, resolveWorkerApplicationIdentity, showPulseToast]);

    const handleHirePro = useCallback(async (pro) => {
        if (!isEmployerRole) { showPulseToast('Switch to Employer role to invite professionals.'); return; }
        const workerId = String(pro?.workerId || pro?.id || '').trim();
        const jobId = String(pro?.jobId || '').trim();
        const candidateName = String(pro?.name || 'Professional').trim() || 'Professional';
        if (!workerId || !jobId) { showPulseToast('Job seeker invite requires a valid worker and job.'); return; }
        try {
            await client.post('/api/applications', { jobId, workerId, initiatedBy: 'employer' }, { __skipApiErrorHandler: true });
            setHiredProIds((prev) => new Set(prev).add(String(pro?.id || workerId)));
            showPulseToast(`Invite sent to ${candidateName}.`);
        } catch (error) {
            const message = String(error?.response?.data?.message || '').trim();
            showPulseToast(message || 'Could not send hire request right now.');
        }
    }, [isEmployerRole, showPulseToast]);

    const resetPulseState = useCallback(() => {
        setPulseItems([]);
        setNearbyPros([]);
        setAppliedGigIds(new Set());
        setHiredProIds(new Set());
        setRadarRefreshing(false);
        setPulseLoading(true);
        setPulseError('');
        setNearbyProsError('');
        nearbyProsAutoLoadedRef.current = false;
        pulseFetchRequestIdRef.current = 0;
    }, []);

    return {
        // State
        pulseItems, nearbyPros, appliedGigIds, hiredProIds,
        radarRefreshing, pulseLoading, pulseError, nearbyProsError,
        pulseAnim, pulseLoopRef, nearbyProsAutoLoadedRef,
        // Handlers
        fetchPulseItems, fetchNearbyPros,
        handleRefreshRadar, handleApplyGig, handleHirePro,
        resetPulseState,
    };
}
