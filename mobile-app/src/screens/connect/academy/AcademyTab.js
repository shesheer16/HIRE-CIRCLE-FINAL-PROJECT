import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity } from 'react-native';
import { IconAward, IconBookOpen, IconSparkles } from '../../../components/Icons';
import MentorCard from './MentorCard';
import { RADIUS } from '../../../theme/theme';
import { connectPalette, connectShadow } from '../connectPalette';

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

function AcademyTabComponent({
    academyCourses,
    enrolledCourses,
    enrolledCourseIds,
    mentors,
    connectedMentorIds,
    onEnrollCourse,
    onConnectMentor,
    contentContainerStyle,
}) {
    const courses = useMemo(() => (
        academyCourses.map((course) => ({
            id: course.id,
            title: course.title,
            instructor: course.instructor || 'HireCircle Academy',
            duration: course.duration || `${Math.max(0, Number(course.lessonCount || 0))} lessons`,
            level: course.level ? `${course.level.charAt(0).toUpperCase()}${course.level.slice(1)}` : 'Beginner',
            enrolled: Number(course.enrolledCount || enrolledCourses.filter((item) => item.courseId === course.id).length || 0),
            lessonCount: Math.max(0, Number(course.lessonCount || 0)),
            thumb: course.thumb || course.thumbnailUrl || course.coverImageUrl || '',
        }))
    ), [academyCourses, enrolledCourses]);

    const totalCourses = courses.length;
    const doneCourses = Math.min(enrolledCourseIds.size, totalCourses);
    const progressPct = useMemo(() => (
        totalCourses > 0 ? Math.round((doneCourses / totalCourses) * 100) : 0
    ), [doneCourses, totalCourses]);
    const karmaEarned = useMemo(() => (enrolledCourseIds.size * 120), [enrolledCourseIds]);
    const progressFillStyle = useMemo(() => [styles.progressFill, { width: `${progressPct}%` }], [progressPct]);

    const isCourseEnrolled = useCallback((courseId) => (
        enrolledCourseIds.has(courseId)
    ), [enrolledCourseIds]);

    const isMentorConnected = useCallback((mentorId) => (
        connectedMentorIds.has(mentorId)
    ), [connectedMentorIds]);

    const courseCards = useMemo(() => (
        courses.map((item) => (
            <CourseCard
                key={item.id}
                course={item}
                isEnrolled={isCourseEnrolled(item.id)}
                onEnrollCourse={onEnrollCourse}
            />
        ))
    ), [courses, isCourseEnrolled, onEnrollCourse]);

    const mentorCards = useMemo(() => (
        mentors.map((item) => (
            <MentorCard
                key={item.id}
                mentor={item}
                isConnected={isMentorConnected(item.id)}
                onConnect={onConnectMentor}
            />
        ))
    ), [mentors, isMentorConnected, onConnectMentor]);

    return (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={contentContainerStyle}>
            <View style={styles.academyCard}>
                <View style={styles.headerRow}>
                    <IconBookOpen size={16} color={connectPalette.accent} />
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

            <View style={styles.sectionHeaderRow}>
                <IconAward size={16} color={connectPalette.accent} />
                <Text style={styles.sectionTitle}>TOP COURSES FOR YOU</Text>
            </View>

            {courseCards.length > 0 ? courseCards : (
                <View style={styles.emptyCard}>
                    <Text style={styles.emptyTitle}>No posts yet.</Text>
                    <Text style={styles.emptySubtitle}>Academy courses will appear here once published.</Text>
                </View>
            )}

            <View style={styles.academyCard}>
                <View style={styles.headerRow}>
                    <IconSparkles size={16} color={connectPalette.accent} />
                    <Text style={styles.headerTitle}>AI MENTOR MATCH</Text>
                </View>
                {mentorCards.length > 0 ? mentorCards : (
                    <Text style={styles.emptySubtitle}>No mentors available right now.</Text>
                )}
            </View>

            <View style={styles.bottomSpace} />
        </ScrollView>
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
    emptyCard: {
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: connectPalette.line,
        backgroundColor: connectPalette.surface,
        paddingHorizontal: 16,
        paddingVertical: 18,
        marginBottom: 12,
    },
    emptyTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: connectPalette.text,
        marginBottom: 6,
    },
    emptySubtitle: {
        fontSize: 12,
        color: connectPalette.muted,
        lineHeight: 18,
    },
});
