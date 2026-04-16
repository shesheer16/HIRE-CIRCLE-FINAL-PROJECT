/**
 * useAcademyData.js
 * Domain hook: Academy tab — courses, enrollment, mentor match, mentor connections.
 * Shared deps: showPulseToast, setShowMyProfile
 */
import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../../api/client';
import {
    CONNECT_READ_TIMEOUT_MS,
    isDemoRecord,
} from './connectUtils';
import {
    SCREENSHOT_ACADEMY_COURSES,
    SCREENSHOT_ACADEMY_ENROLLED,
    SCREENSHOT_ACADEMY_MENTORS,
    SCREENSHOT_CONNECTED_MENTOR_IDS,
    SCREENSHOT_MOCKS_ENABLED,
} from '../../config/screenshotMocks';

const ACADEMY_CACHE_KEY = '@academy_cache_v1';

/**
 * @param {object} params
 * @param {function} params.showPulseToast
 * @param {function} params.setShowMyProfile  — shared nav setter from orchestrator
 */
export function useAcademyData({ showPulseToast, setShowMyProfile }) {
    const [academyCourses, setAcademyCourses] = useState([]);
    const [enrolledCourses, setEnrolledCourses] = useState([]);
    const [enrolledCourseIds, setEnrolledCourseIds] = useState(new Set());
    const [academyMentors, setAcademyMentors] = useState([]);
    const [connectedMentorIds, setConnectedMentorIds] = useState(new Set());
    const [academyLoading, setAcademyLoading] = useState(true);
    const [academyRefreshingMentors, setAcademyRefreshingMentors] = useState(false);
    const [academyError, setAcademyError] = useState('');
    const [academyPullRefreshing, setAcademyPullRefreshing] = useState(false);
    const academyMentorsAutoLoadedRef = useRef(false);
    const academyCachePrimedRef = useRef(false);

    const applyScreenshotMocks = useCallback(() => {
        if (!SCREENSHOT_MOCKS_ENABLED) return;
        setAcademyCourses(SCREENSHOT_ACADEMY_COURSES);
        setEnrolledCourses(SCREENSHOT_ACADEMY_ENROLLED);
        setEnrolledCourseIds(new Set(SCREENSHOT_ACADEMY_ENROLLED.map((item) => String(item?.courseId || '')).filter(Boolean)));
        setAcademyMentors(SCREENSHOT_ACADEMY_MENTORS);
        setConnectedMentorIds(new Set(SCREENSHOT_CONNECTED_MENTOR_IDS));
        setAcademyError('');
        setAcademyLoading(false);
        setAcademyRefreshingMentors(false);
        setAcademyPullRefreshing(false);
    }, []);

    const applyCachedAcademy = useCallback((payload) => {
        try {
            const cachedCourses = Array.isArray(payload?.courses)
                ? payload.courses.filter((item) => item && typeof item === 'object' && !isDemoRecord(item))
                : [];
            const cachedEnrolled = Array.isArray(payload?.enrolled)
                ? payload.enrolled.filter((item) => item && typeof item === 'object' && !isDemoRecord(item))
                : [];
            const cachedMentors = Array.isArray(payload?.mentors)
                ? payload.mentors.filter((item) => item && typeof item === 'object' && !isDemoRecord(item))
                : [];
            const cachedConnectedIds = Array.isArray(payload?.connectedMentorIds)
                ? payload.connectedMentorIds.filter(Boolean)
                : [];

            if (cachedCourses.length) setAcademyCourses(cachedCourses);
            if (cachedEnrolled.length) {
                setEnrolledCourses(cachedEnrolled);
                setEnrolledCourseIds(new Set(cachedEnrolled.map((item) => String(item?.courseId || '')).filter(Boolean)));
            }
            if (cachedMentors.length) setAcademyMentors(cachedMentors);
            if (cachedConnectedIds.length) setConnectedMentorIds(new Set(cachedConnectedIds));

            return (cachedCourses.length + cachedEnrolled.length + cachedMentors.length) > 0;
        } catch (_error) {
            return false;
        }
    }, []);

    const primeAcademyFromCache = useCallback(async () => {
        if (academyCachePrimedRef.current) return false;
        academyCachePrimedRef.current = true;
        try {
            const cachedRaw = await AsyncStorage.getItem(ACADEMY_CACHE_KEY);
            if (!cachedRaw) return false;
            const parsed = JSON.parse(cachedRaw);
            const applied = applyCachedAcademy(parsed);
            if (applied) setAcademyLoading(false);
            return applied;
        } catch (_error) {
            return false;
        }
    }, [applyCachedAcademy, setAcademyLoading]);

    const mapMentorMatchRows = useCallback((rows) => (
        Array.isArray(rows)
            ? rows
                .filter((item) => item && typeof item === 'object' && !isDemoRecord(item))
                .map((item, index) => {
                    const name = String(item.name || 'Mentor').trim() || 'Mentor';
                    return {
                        id: String(item.id || item._id || `mentor-${index + 1}`),
                        name,
                        exp: String(item.exp || item.experience || '5y'),
                        skill: String(item.skill || 'Career Growth'),
                        rating: String(item.rating || '4.6'),
                        sessions: String(item.sessions || '120'),
                        reason: String(item.reason || '').trim(),
                        avatar: String(item.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=8b3dff&color=fff&rounded=true`),
                    };
                })
            : []
    ), []);

    const fetchAcademyData = useCallback(async (options = {}) => {
        if (SCREENSHOT_MOCKS_ENABLED) {
            applyScreenshotMocks();
            return;
        }
        const refreshMentorsOnly = Boolean(options?.refreshMentorsOnly);
        const includeMentorMatch = options?.includeMentorMatch !== false;

        if (refreshMentorsOnly) {
            setAcademyRefreshingMentors(true);
        } else {
            setAcademyLoading(true);
        }
        setAcademyError('');
        const isColdStart = !refreshMentorsOnly && academyCourses.length === 0 && academyMentors.length === 0;
        if (isColdStart) { primeAcademyFromCache(); }

        try {
            const requests = [];
            if (!refreshMentorsOnly) {
                requests.push(client.get('/api/academy/courses', {
                    __skipApiErrorHandler: true, timeout: CONNECT_READ_TIMEOUT_MS, __maxRetries: 1,
                }));
                requests.push(client.get('/api/academy/enrolled', {
                    __skipApiErrorHandler: true, timeout: CONNECT_READ_TIMEOUT_MS, __maxRetries: 1,
                }));
            }
            if (includeMentorMatch) {
                requests.push(client.get('/api/academy/mentor-match', {
                    __skipApiErrorHandler: true, timeout: CONNECT_READ_TIMEOUT_MS, __maxRetries: 1,
                }));
            }
            requests.push(client.get('/api/academy/mentor-requests', {
                __skipApiErrorHandler: true, timeout: CONNECT_READ_TIMEOUT_MS, __maxRetries: 1,
            }));

            const settled = await Promise.allSettled(requests);
            let cursor = 0;

            let coursesResult = null;
            let enrolledResult = null;
            if (!refreshMentorsOnly) {
                coursesResult = settled[cursor++];
                enrolledResult = settled[cursor++];
            }
            const mentorsResult = includeMentorMatch ? settled[cursor++] : null;
            const mentorRequestsResult = settled[cursor];

            let nextCourses = null;
            let nextEnrolled = null;
            let nextMentors = null;
            let nextConnectedIds = null;

            if (!refreshMentorsOnly) {
                if (coursesResult?.status === 'fulfilled') {
                    const courses = Array.isArray(coursesResult.value?.data?.courses)
                        ? coursesResult.value.data.courses.filter((item) => item && typeof item === 'object' && !isDemoRecord(item))
                        : [];
                    setAcademyCourses(courses);
                    nextCourses = courses;
                }
                if (enrolledResult?.status === 'fulfilled') {
                    const enrolled = Array.isArray(enrolledResult.value?.data?.enrolled)
                        ? enrolledResult.value.data.enrolled.filter((item) => item && typeof item === 'object' && !isDemoRecord(item))
                        : [];
                    setEnrolledCourses(enrolled);
                    setEnrolledCourseIds(new Set(enrolled.map((item) => String(item?.courseId || '')).filter(Boolean)));
                    nextEnrolled = enrolled;
                }
            }

            if (mentorsResult?.status === 'fulfilled') {
                const mentors = mapMentorMatchRows(mentorsResult.value?.data?.mentors);
                setAcademyMentors(mentors);
                nextMentors = mentors;
            } else if (includeMentorMatch && refreshMentorsOnly) {
                showPulseToast('AI Mentor Match is temporarily unavailable.');
            }

            if (mentorRequestsResult?.status === 'fulfilled') {
                const requestsList = Array.isArray(mentorRequestsResult.value?.data?.requests)
                    ? mentorRequestsResult.value.data.requests.filter((item) => item && typeof item === 'object')
                    : [];
                const requestIds = new Set(
                    requestsList
                        .filter((item) => ['requested', 'connected'].includes(String(item?.status || '').toLowerCase()))
                        .map((item) => String(item?.mentorId || '').trim())
                        .filter(Boolean)
                );
                setConnectedMentorIds(requestIds);
                nextConnectedIds = requestIds;
            }

            const allFailed = settled.every((result) => result.status === 'rejected');
            if (allFailed) {
                const cachedApplied = await primeAcademyFromCache();
                if (cachedApplied) {
                    setAcademyError('Showing saved Academy — pull to refresh.');
                } else {
                    setAcademyError('No courses to show right now. Pull to refresh.');
                }
            } else {
                AsyncStorage.setItem(ACADEMY_CACHE_KEY, JSON.stringify({
                    courses: nextCourses ?? academyCourses,
                    enrolled: nextEnrolled ?? enrolledCourses,
                    mentors: nextMentors ?? academyMentors,
                    connectedMentorIds: Array.from((nextConnectedIds ?? connectedMentorIds) || []),
                })).catch(() => {});
            }
        } catch (_error) {
            const cachedApplied = await primeAcademyFromCache();
            if (cachedApplied) {
                setAcademyError('Showing saved Academy — pull to refresh.');
            } else {
                setAcademyError('No courses to show right now. Pull to refresh.');
            }
        } finally {
            if (refreshMentorsOnly) {
                setAcademyRefreshingMentors(false);
            } else {
                setAcademyLoading(false);
            }
        }
    }, [
        academyCourses,
        academyMentors,
        enrolledCourses,
        connectedMentorIds,
        mapMentorMatchRows,
        primeAcademyFromCache,
        showPulseToast,
    ]);

    const handleEnrollCourse = useCallback(async (id) => {
        try {
            await client.post(`/api/academy/courses/${id}/enroll`, {}, { __skipApiErrorHandler: true });
            setEnrolledCourseIds((prev) => new Set(prev).add(id));
            setEnrolledCourses((prev) => {
                const safePrev = Array.isArray(prev) ? prev : [];
                if (safePrev.some((item) => String(item?.courseId || '').trim() === String(id))) return safePrev;
                const matchedCourse = Array.isArray(academyCourses)
                    ? academyCourses.find((course) => String(course?.id || course?._id || '').trim() === String(id))
                    : null;
                return [{ courseId: String(id), startedAt: new Date().toISOString(), progressPercent: 0, course: matchedCourse || null }, ...safePrev];
            });
        } catch (error) {
            Alert.alert('Enrollment Failed', 'Could not enroll right now.');
        }
    }, [academyCourses]);

    const handleConnectMentor = useCallback(async (id) => {
        const mentorId = String(id || '').trim();
        if (!mentorId) return;
        if (connectedMentorIds.has(mentorId)) { showPulseToast('Mentor request already sent.'); return; }
        const mentor = Array.isArray(academyMentors)
            ? academyMentors.find((item) => String(item?.id || '').trim() === mentorId)
            : null;
        try {
            await client.post('/api/academy/mentor-requests', {
                mentorId,
                mentorName: String(mentor?.name || 'Mentor').trim() || 'Mentor',
                mentorSkill: String(mentor?.skill || 'Career Growth').trim() || 'Career Growth',
                source: 'academy_ai_match',
            }, { __skipApiErrorHandler: true });
            setConnectedMentorIds((prev) => new Set(prev).add(mentorId));
            showPulseToast('Mentor request sent successfully.');
        } catch (error) {
            const message = String(error?.response?.data?.message || '').trim();
            showPulseToast(message || 'Could not send mentor request right now.');
        }
    }, [academyMentors, connectedMentorIds, showPulseToast]);

    const handleBecomeMentor = useCallback(() => {
        setShowMyProfile(true);
        showPulseToast('Open My Profile and complete your details to become a mentor.');
    }, [setShowMyProfile, showPulseToast]);

    const handleRefreshMentors = useCallback(() => {
        return fetchAcademyData({ refreshMentorsOnly: true });
    }, [fetchAcademyData]);

    const handleRetryAcademy = useCallback(() => {
        return fetchAcademyData({ refreshMentorsOnly: false });
    }, [fetchAcademyData]);

    const handleRefreshAcademy = useCallback(async () => {
        setAcademyPullRefreshing(true);
        await fetchAcademyData({ refreshMentorsOnly: false });
        setAcademyPullRefreshing(false);
    }, [fetchAcademyData]);

    const resetAcademyState = useCallback(() => {
        setAcademyCourses([]);
        setEnrolledCourses([]);
        setEnrolledCourseIds(new Set());
        setAcademyMentors([]);
        setConnectedMentorIds(new Set());
        setAcademyLoading(true);
        setAcademyRefreshingMentors(false);
        setAcademyError('');
        setAcademyPullRefreshing(false);
        academyMentorsAutoLoadedRef.current = false;
    }, []);

    return {
        // State
        academyCourses, enrolledCourses, enrolledCourseIds,
        academyMentors, connectedMentorIds, academyLoading,
        academyRefreshingMentors, academyError, academyPullRefreshing,
        academyMentorsAutoLoadedRef,
        // Handlers
        fetchAcademyData, handleEnrollCourse, handleConnectMentor,
        handleBecomeMentor, handleRefreshMentors, handleRetryAcademy,
        handleRefreshAcademy, resetAcademyState,
    };
}
