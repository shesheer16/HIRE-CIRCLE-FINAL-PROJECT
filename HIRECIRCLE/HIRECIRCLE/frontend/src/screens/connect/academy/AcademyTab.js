import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, RefreshControl } from 'react-native';
import { IconAward, IconBookOpen, IconSparkles } from '../../../components/Icons';
import MentorCard from './MentorCard';
import { RADIUS } from '../../../theme/theme';
import { connectPalette, connectShadow } from '../connectPalette';
import { ConnectSkeletonBlock, ConnectSkeletonCard } from '../ConnectSkeletons';
import ConnectEmptyStateCard from '../ConnectEmptyState';

const getLevelStyle = (level) => {
    if (level === 'Beginner') {
        return {
            badge: styles.levelBeginnerBg,
            text: styles.levelBeginnerText,
        };
    }

    if (level === 'Intermediate') {
        return {
            badge: styles.levelIntermediateBg,
            text: styles.levelIntermediateText,
        };
    }

    return {
        badge: styles.levelAdvancedBg,
        text: styles.levelAdvancedText,
    };
};

function CourseCardComponent({ course, isEnrolled, onEnrollCourse }) {
    const handleEnroll = useCallback(() => {
        if (!isEnrolled) {
            onEnrollCourse(course.id);
        }
    }, [isEnrolled, onEnrollCourse, course.id]);

    const levelStyle = useMemo(() => getLevelStyle(course.level), [course.level]);
    const isTrending = Number(course.enrolled || 0) >= 500;
    const enrollButtonStyle = useMemo(() => [
        styles.actionButton,
        isEnrolled && styles.actionButtonDone,
    ], [isEnrolled]);

    const enrollButtonTextStyle = useMemo(() => [
        styles.actionButtonText,
        isEnrolled && styles.actionButtonTextDone,
    ], [isEnrolled]);

    return (
        <View style={styles.courseCard}>
            {course.thumb ? (
                <Image source={{ uri: course.thumb }} style={styles.courseThumb} />
            ) : (
                <View style={styles.courseThumbPlaceholder}>
                    <IconBookOpen size={20} color={connectPalette.accentDark} />
                </View>
            )}
            <View style={styles.courseContent}>
                <View style={styles.courseHeaderRow}>
                    <Text style={styles.courseTitle}>{course.title}</Text>
                    <View style={styles.courseHeaderBadges}>
                        {isTrending ? (
                            <View style={styles.trendingBadge}>
                                <Text style={styles.trendingBadgeText}>TRENDING</Text>
                            </View>
                        ) : null}
                        <View style={[styles.levelBadge, levelStyle.badge]}>
                            <Text style={[styles.levelBadgeText, levelStyle.text]}>{course.level.toUpperCase()}</Text>
                        </View>
                    </View>
                </View>
                <Text style={styles.courseInstructor}>{course.instructor} · {course.duration}</Text>
                <View style={styles.courseFooterRow}>
                    <Text style={styles.courseMeta}>{course.lessonCount} lessons · {course.enrolled.toLocaleString()} enrolled</Text>
                    <TouchableOpacity
                        style={enrollButtonStyle}
                        onPress={handleEnroll}
                        disabled={isEnrolled}
                    >
                        <Text style={enrollButtonTextStyle}>{isEnrolled ? 'ENROLLED ✓' : 'START'}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
}

const CourseCard = memo(CourseCardComponent);

const CourseSkeleton = memo(function CourseSkeletonComponent() {
    return (
        <ConnectSkeletonCard style={styles.skeletonCard}>
            <View style={styles.skeletonRow}>
                <ConnectSkeletonBlock width={90} height={64} radius={12} />
                <View style={styles.skeletonColumn}>
                    <ConnectSkeletonBlock width="70%" height={12} radius={7} />
                    <ConnectSkeletonBlock width="52%" height={10} radius={6} style={styles.skeletonLine} />
                    <ConnectSkeletonBlock width="60%" height={10} radius={6} style={styles.skeletonLine} />
                </View>
            </View>
        </ConnectSkeletonCard>
    );
});

const MentorSkeleton = memo(function MentorSkeletonComponent() {
    return (
        <ConnectSkeletonCard style={styles.skeletonCard}>
            <View style={styles.skeletonRow}>
                <ConnectSkeletonBlock width={48} height={48} radius={24} />
                <View style={styles.skeletonColumn}>
                    <ConnectSkeletonBlock width="46%" height={12} radius={7} />
                    <ConnectSkeletonBlock width="64%" height={10} radius={6} style={styles.skeletonLine} />
                </View>
            </View>
            <View style={styles.skeletonChipRow}>
                <ConnectSkeletonBlock width={72} height={24} radius={12} />
                <ConnectSkeletonBlock width={88} height={24} radius={12} />
            </View>
        </ConnectSkeletonCard>
    );
});

function AcademyTabComponent({
    academyCourses,
    enrolledCourses,
    enrolledCourseIds,
    mentors,
    connectedMentorIds,
    isLoading,
    isMentorRefreshing,
    academyError,
    onEnrollCourse,
    onConnectMentor,
    onRefreshMentors,
    onRetryAcademy,
    onRefreshAcademy,
    isRefreshing,
    onBecomeMentor,
    onStartReferralAction,
    contentContainerStyle,
}) {
    const safeAcademyCourses = useMemo(() => (
        Array.isArray(academyCourses)
            ? academyCourses.filter((course) => course && typeof course === 'object')
            : []
    ), [academyCourses]);
    const safeEnrolledCourses = useMemo(() => (
        Array.isArray(enrolledCourses)
            ? enrolledCourses.filter((item) => item && typeof item === 'object')
            : []
    ), [enrolledCourses]);
    const safeMentors = Array.isArray(mentors)
        ? mentors.filter((mentor) => mentor && typeof mentor === 'object')
        : [];
    const safeEnrolledCourseIds = enrolledCourseIds instanceof Set ? enrolledCourseIds : new Set();
    const safeConnectedMentorIds = connectedMentorIds instanceof Set ? connectedMentorIds : new Set();

    const courses = useMemo(() => (
        safeAcademyCourses.map((course, index) => {
            const safeCourse = (course && typeof course === 'object') ? course : {};
            const courseId = String(safeCourse.id || safeCourse._id || `course-${index}`);
            return {
                id: courseId,
                title: String(safeCourse.title || 'Untitled Course'),
                instructor: safeCourse.instructor || 'HireCircle Academy',
                duration: safeCourse.duration || `${Math.max(0, Number(safeCourse.lessonCount || 0))} lessons`,
                level: safeCourse.level ? `${safeCourse.level.charAt(0).toUpperCase()}${safeCourse.level.slice(1)}` : 'Beginner',
                enrolled: Number(safeCourse.enrolledCount || safeEnrolledCourses.filter((item) => String(item?.courseId || '') === courseId).length || 0),
                lessonCount: Math.max(0, Number(safeCourse.lessonCount || 0)),
                thumb: safeCourse.thumb || safeCourse.thumbnailUrl || safeCourse.coverImageUrl || '',
            };
        })
    ), [safeAcademyCourses, safeEnrolledCourses]);

    const totalCourses = courses.length;
    const doneCourses = Math.min(safeEnrolledCourseIds.size, totalCourses);
    const progressPct = useMemo(() => (
        totalCourses > 0 ? Math.round((doneCourses / totalCourses) * 100) : 0
    ), [doneCourses, totalCourses]);
    const karmaEarned = useMemo(() => (safeEnrolledCourseIds.size * 120), [safeEnrolledCourseIds]);
    const progressFillStyle = useMemo(() => [styles.progressFill, { width: `${progressPct}%` }], [progressPct]);

    const isCourseEnrolled = useCallback((courseId) => (
        safeEnrolledCourseIds.has(courseId)
    ), [safeEnrolledCourseIds]);

    const isMentorConnected = useCallback((mentorId) => (
        safeConnectedMentorIds.has(mentorId)
    ), [safeConnectedMentorIds]);

    const courseKeyExtractor = useCallback((item) => String(item.id), []);

    const renderCourseItem = useCallback(({ item }) => (
        <CourseCard
            course={item}
            isEnrolled={isCourseEnrolled(item.id)}
            onEnrollCourse={onEnrollCourse}
        />
    ), [isCourseEnrolled, onEnrollCourse]);

    const mentorCards = useMemo(() => (
        safeMentors.map((item) => (
            <MentorCard
                key={item.id}
                mentor={item}
                isConnected={isMentorConnected(item.id)}
                onConnect={onConnectMentor}
            />
        ))
    ), [safeMentors, isMentorConnected, onConnectMentor]);

    const mentorRefreshLabel = isMentorRefreshing ? 'Running Match...' : 'Run AI Mentor Match';
    const showCourseLoading = Boolean(isLoading) && courses.length === 0;
    const showMentorLoading = Boolean(isLoading || isMentorRefreshing) && mentorCards.length === 0;
    const showFullAcademyError = Boolean(academyError) && !showCourseLoading && !showMentorLoading && courses.length === 0 && mentorCards.length === 0;

    const listHeader = useMemo(() => (
        <>
            <View style={styles.academyCard}>
                <View style={styles.headerRow}>
                    <IconAward size={16} color={connectPalette.accent} />
                    <Text style={styles.headerTitle}>MY LEARNING</Text>
                    <View style={styles.karmaBadge}>
                        <Text style={styles.karmaText}>+{karmaEarned} KARMA</Text>
                    </View>
                </View>
                <View style={styles.progressHeaderRow}>
                    <Text style={styles.progressCaption}>{doneCourses} / {totalCourses} Courses</Text>
                    <Text style={styles.progressPercent}>{progressPct}%</Text>
                </View>
                <View style={styles.progressTrack}>
                    <View style={progressFillStyle} />
                </View>
                <Text style={styles.progressSubcopy}>
                    {totalCourses > 0 ? 'Track your course completion here.' : 'No courses published yet.'}
                </Text>
            </View>

            {academyError && !showFullAcademyError ? (
                <ConnectEmptyStateCard
                    title="Showing last saved courses"
                    subtitle="We couldn't refresh just now. Pull to refresh anytime."
                    actionLabel="Try again"
                    onAction={onRetryAcademy}
                    tone="info"
                    inline
                    style={styles.inlineStatusCard}
                />
            ) : null}

            {showFullAcademyError ? (
                <ConnectEmptyStateCard
                    title="No courses to show right now"
                    subtitle="We couldn't load Academy just now. Pull to refresh."
                    actionLabel="Try again"
                    onAction={onRetryAcademy}
                    tone="info"
                    style={styles.emptyStateCard}
                />
            ) : null}

            {!showFullAcademyError ? (
                <View style={styles.sectionHeaderRow}>
                    <IconAward size={16} color={connectPalette.accent} />
                    <Text style={styles.sectionTitle}>TOP COURSES FOR YOU</Text>
                </View>
            ) : null}

            {showCourseLoading ? (
                <>
                    <CourseSkeleton />
                    <CourseSkeleton />
                </>
            ) : null}

            {!showCourseLoading && !showFullAcademyError && courses.length === 0 ? (
                <ConnectEmptyStateCard
                    title="No courses yet"
                    subtitle="Academy courses will appear here once published."
                    style={styles.emptyStateCard}
                />
            ) : null}
        </>
    ), [
        academyError,
        courses.length,
        doneCourses,
        karmaEarned,
        onRetryAcademy,
        progressFillStyle,
        progressPct,
        showCourseLoading,
        showFullAcademyError,
        totalCourses,
    ]);

    const listFooter = useMemo(() => (
        <>
            {!showFullAcademyError ? (
                <View style={styles.academyCard}>
                    <View style={styles.headerRow}>
                        <Text style={styles.headerTitle}>AI MENTOR MATCH</Text>
                    </View>
                    <View style={styles.mentorActionRow}>
                        <TouchableOpacity
                            style={styles.mentorRefreshButton}
                            onPress={onRefreshMentors}
                            activeOpacity={0.85}
                            disabled={isMentorRefreshing}
                        >
                            <Text style={styles.mentorRefreshButtonText}>{mentorRefreshLabel}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.mentorBecomeButton}
                            onPress={onBecomeMentor}
                            activeOpacity={0.85}
                        >
                            <Text style={styles.mentorBecomeButtonText}>Become a Mentor</Text>
                        </TouchableOpacity>
                    </View>

                    {showMentorLoading ? (
                        <>
                            <MentorSkeleton />
                            <MentorSkeleton />
                        </>
                    ) : (mentorCards.length > 0 ? mentorCards : (
                        <ConnectEmptyStateCard
                            title="No mentors yet"
                            subtitle="No mentors available yet. Run the AI match to fetch mentors."
                            style={styles.emptyStateCard}
                        />
                    ))}
                </View>
            ) : null}

            <View style={styles.academyCard}>
                <View style={styles.headerRow}>
                    <IconAward size={16} color={connectPalette.accent} />
                    <Text style={styles.headerTitle}>REFERRAL ECONOMY</Text>
                </View>
                <Text style={styles.emptySubtitle}>
                    Start your referral journey and unlock rewards as your network grows.
                </Text>
                <TouchableOpacity
                    style={styles.referralButton}
                    onPress={onStartReferralAction}
                    activeOpacity={0.85}
                >
                    <Text style={styles.referralButtonText}>Start Referring</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.bottomSpace} />
        </>
    ), [
        isMentorRefreshing,
        mentorCards,
        mentorRefreshLabel,
        onBecomeMentor,
        onRefreshMentors,
        onStartReferralAction,
        showFullAcademyError,
        showMentorLoading,
    ]);

    return (
        <FlatList
            data={showCourseLoading || showFullAcademyError ? [] : courses}
            keyExtractor={courseKeyExtractor}
            renderItem={renderCourseItem}
            ListHeaderComponent={listHeader}
            ListFooterComponent={listFooter}
            contentContainerStyle={contentContainerStyle}
            showsVerticalScrollIndicator={false}
            refreshControl={(
                <RefreshControl
                    refreshing={Boolean(isRefreshing)}
                    onRefresh={onRefreshAcademy}
                    tintColor={connectPalette.accent}
                    colors={[connectPalette.accent]}
                />
            )}
        />
    );
}

export default memo(AcademyTabComponent);

const styles = StyleSheet.create({
    academyCard: {
        backgroundColor: connectPalette.surface,
        borderRadius: RADIUS.xl,
        padding: 20,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: connectPalette.line,
        ...connectShadow,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 16,
    },
    headerTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: connectPalette.text,
    },
    karmaBadge: {
        marginLeft: 'auto',
        backgroundColor: connectPalette.accentSoft,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: RADIUS.md,
    },
    karmaText: {
        fontSize: 10,
        fontWeight: '800',
        color: connectPalette.accentDark,
    },
    progressHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    progressCaption: {
        fontSize: 11,
        fontWeight: '700',
        color: connectPalette.muted,
    },
    progressPercent: {
        fontSize: 12,
        fontWeight: '800',
        color: connectPalette.text,
    },
    progressTrack: {
        height: 6,
        backgroundColor: connectPalette.accentSoft,
        borderRadius: RADIUS.sm,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: connectPalette.accent,
        borderRadius: RADIUS.sm,
    },
    progressSubcopy: {
        fontSize: 10,
        color: connectPalette.subtle,
        marginTop: 6,
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
        gap: 8,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: connectPalette.text,
        letterSpacing: 1,
    },
    courseCard: {
        backgroundColor: connectPalette.surface,
        borderRadius: RADIUS.xl,
        padding: 14,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: connectPalette.line,
        flexDirection: 'row',
        gap: 12,
        alignItems: 'flex-start',
        ...connectShadow,
    },
    courseThumb: {
        width: 90,
        height: 64,
        borderRadius: RADIUS.md,
        backgroundColor: connectPalette.lineStrong,
    },
    courseThumbPlaceholder: {
        width: 90,
        height: 64,
        borderRadius: RADIUS.md,
        backgroundColor: connectPalette.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
    },
    courseContent: {
        flex: 1,
        minWidth: 0,
    },
    courseHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 2,
        gap: 4,
    },
    courseHeaderBadges: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    trendingBadge: {
        borderRadius: RADIUS.sm,
        borderWidth: 1,
        borderColor: '#fecaca',
        backgroundColor: '#fee2e2',
        paddingHorizontal: 6,
        paddingVertical: 3,
    },
    trendingBadgeText: {
        color: '#b91c1c',
        fontSize: 9,
        fontWeight: '900',
        letterSpacing: 0.35,
    },
    courseTitle: {
        flex: 1,
        fontSize: 13,
        fontWeight: '800',
        color: connectPalette.text,
    },
    levelBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: RADIUS.sm,
    },
    levelBadgeText: {
        fontSize: 10,
        fontWeight: '800',
    },
    levelBeginnerBg: {
        backgroundColor: '#f2f4f8',
    },
    levelBeginnerText: {
        color: connectPalette.success,
    },
    levelIntermediateBg: {
        backgroundColor: connectPalette.accentSoft,
    },
    levelIntermediateText: {
        color: connectPalette.warning,
    },
    levelAdvancedBg: {
        backgroundColor: '#ece8ff',
    },
    levelAdvancedText: {
        color: connectPalette.accentDark,
    },
    courseInstructor: {
        fontSize: 10,
        fontWeight: '700',
        color: connectPalette.subtle,
        marginTop: 2,
    },
    courseFooterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 6,
    },
    courseMeta: {
        fontSize: 10,
        color: connectPalette.subtle,
        fontWeight: '600',
        flex: 1,
        marginRight: 12,
    },
    actionButton: {
        backgroundColor: connectPalette.dark,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: RADIUS.md,
    },
    actionButtonDone: {
        backgroundColor: connectPalette.accentSoft,
    },
    actionButtonText: {
        fontSize: 10,
        fontWeight: '900',
        color: connectPalette.surface,
    },
    actionButtonTextDone: {
        color: connectPalette.accentDark,
    },
    bottomSpace: {
        height: 32,
    },
    emptySubtitle: {
        fontSize: 12,
        color: connectPalette.muted,
        lineHeight: 18,
    },
    emptyStateCard: {
        marginBottom: 12,
    },
    inlineStatusCard: {
        marginBottom: 12,
    },
    statusCard: {
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: connectPalette.line,
        backgroundColor: connectPalette.surface,
        paddingHorizontal: 16,
        paddingVertical: 14,
        marginBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    statusText: {
        flex: 1,
        fontSize: 12,
        color: connectPalette.muted,
        lineHeight: 18,
    },
    statusRetryButton: {
        backgroundColor: connectPalette.accent,
        borderRadius: RADIUS.md,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    statusRetryButtonText: {
        color: connectPalette.surface,
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    skeletonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    skeletonCard: {
        marginHorizontal: 0,
    },
    skeletonColumn: {
        flex: 1,
        minWidth: 0,
    },
    skeletonLine: {
        marginTop: 8,
    },
    skeletonChipRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 12,
    },
    mentorActionRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    mentorRefreshButton: {
        alignSelf: 'flex-start',
        backgroundColor: connectPalette.accent,
        borderRadius: RADIUS.md,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    mentorRefreshButtonText: {
        color: connectPalette.surface,
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.3,
    },
    mentorBecomeButton: {
        alignSelf: 'flex-start',
        backgroundColor: connectPalette.surface,
        borderWidth: 1,
        borderColor: connectPalette.lineStrong,
        borderRadius: RADIUS.md,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    mentorBecomeButtonText: {
        color: connectPalette.text,
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    referralButton: {
        marginTop: 12,
        alignSelf: 'flex-start',
        backgroundColor: connectPalette.accent,
        borderRadius: RADIUS.md,
        paddingHorizontal: 14,
        paddingVertical: 9,
    },
    referralButtonText: {
        color: connectPalette.surface,
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.25,
    },
});
