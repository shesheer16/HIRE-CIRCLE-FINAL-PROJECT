/**
 * useBountiesData.js
 * Domain hook: Bounties tab — bounty list, creation, submission, referrals.
 * Shared deps: showBountyToast, currentUserId
 */
import { useCallback, useState } from 'react';
import { Alert, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../../api/client';
import {
    CONNECT_READ_TIMEOUT_MS,
    isDemoRecord,
    getApiErrorMessage,
} from './connectUtils';
import {
    SCREENSHOT_BOUNTIES,
    SCREENSHOT_BOUNTY_REFERRED_IDS,
    SCREENSHOT_BOUNTY_STATS,
    SCREENSHOT_MOCKS_ENABLED,
} from '../../config/screenshotMocks';

const BOUNTIES_CACHE_KEY = '@bounties_cache_v1';

/**
 * @param {object} params
 * @param {string} params.currentUserId
 * @param {function} params.showBountyToast
 */
export function useBountiesData({ currentUserId, showBountyToast }) {
    const [bountyItems, setBountyItems] = useState([]);
    const [referralStats, setReferralStats] = useState(null);
    const [referredBountyIds, setReferredBountyIds] = useState(new Set());
    const [bountiesLoading, setBountiesLoading] = useState(true);
    const [bountiesRefreshing, setBountiesRefreshing] = useState(false);
    const [bountiesError, setBountiesError] = useState('');
    const [bountyActionInFlightId, setBountyActionInFlightId] = useState('');
    const [bountyCreating, setBountyCreating] = useState(false);
    const [referringBounty, setReferringBounty] = useState(null);
    const [referPhoneInput, setReferPhoneInput] = useState('');
    const [referPhoneError, setReferPhoneError] = useState('');
    const [referSending, setReferSending] = useState(false);

    const applyScreenshotMocks = useCallback(() => {
        if (!SCREENSHOT_MOCKS_ENABLED) return;
        setBountyItems(SCREENSHOT_BOUNTIES);
        setReferralStats(SCREENSHOT_BOUNTY_STATS);
        setReferredBountyIds(new Set(SCREENSHOT_BOUNTY_REFERRED_IDS));
        setBountiesLoading(false);
        setBountiesRefreshing(false);
        setBountiesError('');
    }, []);

    const primeBountiesFromCache = useCallback(async () => {
        try {
            const cachedRaw = await AsyncStorage.getItem(BOUNTIES_CACHE_KEY);
            if (!cachedRaw) return false;
            const parsed = JSON.parse(cachedRaw);
            if (!parsed || typeof parsed !== 'object') return false;
            const cachedItems = Array.isArray(parsed.items) ? parsed.items : [];
            const cachedReferredIds = Array.isArray(parsed.referredIds) ? parsed.referredIds : [];
            const cachedStats = parsed.referralStats && typeof parsed.referralStats === 'object' ? parsed.referralStats : { totalEarnings: 0 };
            if (cachedItems.length) setBountyItems(cachedItems);
            setReferralStats(cachedStats);
            setReferredBountyIds(new Set(cachedReferredIds.filter(Boolean)));
            setBountiesLoading(false);
            return cachedItems.length > 0;
        } catch (_error) {
            return false;
        }
    }, []);

    const fetchBounties = useCallback(async (options = {}) => {
        if (SCREENSHOT_MOCKS_ENABLED) {
            applyScreenshotMocks();
            return;
        }
        const refreshing = Boolean(options?.refreshing);
        const isColdStart = !refreshing && bountyItems.length === 0;
        if (isColdStart) { primeBountiesFromCache(); }
        if (refreshing) {
            setBountiesRefreshing(true);
        } else {
            setBountiesLoading(true);
        }
        setBountiesError('');
        const loadCap = setTimeout(() => {
            setBountiesLoading(false);
            setBountiesRefreshing(false);
            setBountiesError((prev) => prev || 'Bounties are taking longer than usual. Pull to refresh.');
        }, 5000);

        try {
            const settled = await Promise.allSettled([
                client.get('/api/bounties', {
                    __skipApiErrorHandler: true, timeout: CONNECT_READ_TIMEOUT_MS, __maxRetries: 1,
                }),
                client.get('/api/bounties/mine', {
                    __skipApiErrorHandler: true, timeout: CONNECT_READ_TIMEOUT_MS, __maxRetries: 1,
                }),
                client.get('/api/growth/referrals', {
                    __skipApiErrorHandler: true, timeout: CONNECT_READ_TIMEOUT_MS, __maxRetries: 1,
                }),
            ]);
            const [bountyResult, mineResult, referralResult] = settled;
            const allFailed = settled.every((result) => result.status === 'rejected');

            if (allFailed) {
                setBountyItems([]);
                setReferralStats({ totalEarnings: 0 });
                setBountiesError('Could not load bounties right now. Pull down to retry.');
                return;
            }

            const rows = bountyResult.status === 'fulfilled' && Array.isArray(bountyResult.value?.data?.bounties)
                ? bountyResult.value.data.bounties.filter((item) => item && typeof item === 'object' && !isDemoRecord(item))
                : [];
            const mine = mineResult.status === 'fulfilled' && Array.isArray(mineResult.value?.data?.bounties)
                ? mineResult.value.data.bounties.filter((item) => item && typeof item === 'object' && !isDemoRecord(item))
                : [];
            const mineMap = new Map(
                mine.map((row) => [String(row?._id || '').trim(), row]).filter(([id]) => Boolean(id))
            );

            const mapped = rows.map((bounty, index) => {
                const bountyId = String(bounty?._id || '').trim();
                const status = String(bounty?.status || 'open').trim().toLowerCase() || 'open';
                const reward = Math.max(0, Number(bounty?.reward || 0));
                const deadlineMs = new Date(bounty?.deadline || Date.now()).getTime();
                const expiresInDays = Number.isFinite(deadlineMs)
                    ? Math.max(0, Math.ceil((deadlineMs - Date.now()) / (24 * 60 * 60 * 1000))) : 0;
                const submissions = Array.isArray(bounty?.submissions)
                    ? bounty.submissions.filter((item) => item && typeof item === 'object') : [];
                const submissionCount = submissions.length;
                const mineRow = mineMap.get(bountyId) || null;
                const hasSubmitted = submissions.some((item) => String(item?.userId || '').trim() === currentUserId)
                    || Boolean(Array.isArray(mineRow?.submissions) && mineRow.submissions.some((item) => String(item?.userId || '').trim() === currentUserId));
                const isCreator = Boolean(mineRow?.isCreator) || String(bounty?.creatorId || '').trim() === currentUserId;
                const isWinner = Boolean(mineRow?.isWinner) || String(bounty?.winnerId || '').trim() === currentUserId;
                const company = String(bounty?.creatorName || '').trim() || `Creator ${index + 1}`;
                return {
                    id: bountyId,
                    company,
                    logoLetter: String(company || 'H')[0].toUpperCase(),
                    logoBg: '#7c3aed',
                    role: String(bounty?.title || '').trim() || 'Open Bounty',
                    description: String(bounty?.description || '').trim(),
                    bonus: `₹${reward.toLocaleString()}`,
                    bonusValue: reward,
                    status,
                    expiresInDays,
                    totalPot: `₹${(reward * Math.max(1, submissionCount || 1)).toLocaleString()}`,
                    referrals: submissionCount,
                    category: status.toUpperCase(),
                    hasSubmitted, isCreator, isWinner,
                    deadline: bounty?.deadline || null,
                };
            });

            setBountyItems(mapped);
            const stats = {
                totalEarnings: mapped.reduce((sum, row) => (row?.isWinner ? sum + Number(row?.bonusValue || 0) : sum), 0),
            };
            setReferralStats(stats);
            let nextReferredIds = new Set(referredBountyIds);

            if (referralResult.status === 'fulfilled') {
                const referrals = Array.isArray(referralResult.value?.data?.referrals)
                    ? referralResult.value.data.referrals : [];
                const hydratedReferredIds = new Set(
                    referrals.map((row) => String(row?.bounty?._id || row?.bounty || '').trim()).filter(Boolean)
                );
                setReferredBountyIds(hydratedReferredIds);
                nextReferredIds = hydratedReferredIds;
            }
            AsyncStorage.setItem(BOUNTIES_CACHE_KEY, JSON.stringify({
                items: mapped,
                referralStats: stats,
                referredIds: Array.from(nextReferredIds),
            })).catch(() => {});

            if (bountyResult.status === 'rejected') {
                setBountiesError('Could not load bounties right now. Pull down to retry.');
            }
        } catch (_error) {
            const cached = await primeBountiesFromCache();
            if (!cached) {
                setBountyItems([]);
                setReferralStats({ totalEarnings: 0 });
                setBountiesError('Could not load bounties right now. Pull down to retry.');
            } else {
                setBountiesError('Showing saved bounties — pull to refresh.');
            }
        } finally {
            clearTimeout(loadCap);
            setBountiesLoading(false);
            setBountiesRefreshing(false);
        }
    }, [bountyItems.length, currentUserId, primeBountiesFromCache, referredBountyIds]);

    const handleRefreshBounties = useCallback(async () => {
        await fetchBounties({ refreshing: true });
    }, [fetchBounties]);

    const handleCreateBounty = useCallback(async ({ title, description, reward, deadline } = {}) => {
        const normalizedTitle = String(title || '').trim();
        const normalizedDescription = String(description || '').trim();
        const normalizedReward = Number(reward || 0);
        const deadlineDate = new Date(deadline || '');
        if (normalizedTitle.length < 2) return { ok: false, message: 'Title must be at least 2 characters.' };
        if (!Number.isFinite(normalizedReward) || normalizedReward <= 0) return { ok: false, message: 'Reward must be greater than 0.' };
        if (!Number.isFinite(deadlineDate.getTime()) || deadlineDate.getTime() <= Date.now()) return { ok: false, message: 'Deadline must be a future date.' };
        setBountyCreating(true);
        try {
            await client.post('/api/bounties', {
                title: normalizedTitle,
                description: normalizedDescription || undefined,
                reward: normalizedReward,
                deadline: deadlineDate.toISOString(),
            }, { __skipApiErrorHandler: true });
            await fetchBounties({ refreshing: false });
            showBountyToast('Bounty published successfully.');
            return { ok: true };
        } catch (error) {
            return { ok: false, message: getApiErrorMessage(error, 'Could not create bounty right now.') };
        } finally {
            setBountyCreating(false);
        }
    }, [fetchBounties, showBountyToast]);

    const handleSubmitBountyEntry = useCallback(async ({ bountyId, message, attachmentUrl } = {}) => {
        const normalizedBountyId = String(bountyId || '').trim();
        if (!normalizedBountyId) return { ok: false, message: 'Invalid bounty selected.' };
        const normalizedMessage = String(message || '').trim();
        const normalizedAttachmentUrl = String(attachmentUrl || '').trim();
        setBountyActionInFlightId(normalizedBountyId);
        try {
            await client.post(`/api/bounties/${normalizedBountyId}/submit`, {
                message: normalizedMessage || undefined,
                attachmentUrl: normalizedAttachmentUrl || undefined,
            }, { __skipApiErrorHandler: true });
            await fetchBounties({ refreshing: false });
            showBountyToast('Bounty entry submitted.');
            return { ok: true };
        } catch (error) {
            return { ok: false, message: getApiErrorMessage(error, 'Could not submit bounty entry right now.') };
        } finally {
            setBountyActionInFlightId('');
        }
    }, [fetchBounties, showBountyToast]);

    const handleOpenReferModal = useCallback((bounty) => {
        const safeBounty = (bounty && typeof bounty === 'object') ? bounty : null;
        const status = String(safeBounty?.status || 'open').trim().toLowerCase();
        if (!safeBounty?.id) return;
        if (!['open', 'reviewing'].includes(status)) { showBountyToast('This bounty is closed for referrals.'); return; }
        setReferringBounty(safeBounty);
        setReferPhoneInput('');
        setReferPhoneError('');
    }, [showBountyToast]);

    const handleStartReferralAction = useCallback(async () => {
        const firstBounty = Array.isArray(bountyItems)
            ? bountyItems.find((item) => ['open', 'reviewing'].includes(String(item?.status || '').toLowerCase()))
            : null;
        if (firstBounty?.id) { handleOpenReferModal(firstBounty); return; }
        try {
            const { data } = await client.get('/api/growth/referrals/invite-link', { __skipApiErrorHandler: true });
            const inviteLink = String(data?.inviteLink || '').trim();
            if (!inviteLink) throw new Error('Invite link unavailable');
            await Share.share({ message: `Join HireCircle with my referral link: ${inviteLink}` });
            showBountyToast('Referral flow started. Share your invite link to earn rewards.');
        } catch (_error) {
            Alert.alert('Referral unavailable', 'Could not start referral flow right now.');
        }
    }, [bountyItems, handleOpenReferModal, showBountyToast]);

    const handleCloseReferModal = useCallback(() => {
        setReferringBounty(null);
        setReferPhoneInput('');
        setReferPhoneError('');
    }, []);

    const handleReferPhoneChange = useCallback((value) => {
        setReferPhoneInput(value);
        setReferPhoneError('');
    }, []);

    const handleSendReferral = useCallback(async () => {
        if (referSending) return;
        if (!referPhoneInput.trim() || referPhoneInput.replace(/\D/g, '').length < 10) {
            setReferPhoneError('Please enter a valid 10-digit phone number');
            return;
        }
        if (!referringBounty) return;
        setReferSending(true);
        try {
            await client.post('/api/growth/referrals', {
                bountyId: referringBounty.id,
                candidateContact: referPhoneInput,
            }, { __skipApiErrorHandler: true });
            const linkRes = await client.get(`/api/growth/share-link/bounty/${referringBounty.id}`, { __skipApiErrorHandler: true });
            const shareLink = linkRes?.data?.shareLink;
            if (shareLink) await Share.share({ message: `Check this opportunity on HireCircle: ${shareLink}` });
            setReferredBountyIds((prev) => new Set(prev).add(referringBounty.id));
            await fetchBounties({ refreshing: false });
            const earned = referringBounty.bonus;
            handleCloseReferModal();
            showBountyToast(`Referral sent! You'll earn ${earned} when they join.`);
        } catch (error) {
            setReferPhoneError(getApiErrorMessage(error, 'Could not send referral. Please try again.'));
        } finally {
            setReferSending(false);
        }
    }, [referPhoneInput, referringBounty, handleCloseReferModal, showBountyToast, referSending, fetchBounties]);

    const resetBountiesState = useCallback(() => {
        setBountyItems([]);
        setReferralStats(null);
        setReferredBountyIds(new Set());
        setBountiesLoading(true);
        setBountiesRefreshing(false);
        setBountiesError('');
        setBountyActionInFlightId('');
        setBountyCreating(false);
        setReferringBounty(null);
        setReferPhoneInput('');
        setReferPhoneError('');
        setReferSending(false);
    }, []);

    return {
        // State
        bountyItems, referralStats, referredBountyIds,
        bountiesLoading, bountiesRefreshing, bountiesError,
        bountyActionInFlightId, bountyCreating,
        referringBounty, referPhoneInput, referPhoneError, referSending,
        // Handlers
        fetchBounties, handleRefreshBounties, handleCreateBounty,
        handleSubmitBountyEntry, handleOpenReferModal, handleStartReferralAction,
        handleCloseReferModal, handleReferPhoneChange, handleSendReferral,
        resetBountiesState,
    };
}
