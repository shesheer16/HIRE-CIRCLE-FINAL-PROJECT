const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');
const Course = require('../models/Course');
const UserCourseProgress = require('../models/UserCourseProgress');
const Post = require('../models/Post');
const { sanitizeText } = require('../utils/sanitizeText');

const MAX_LIMIT = 30;
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || '').trim());

const sanitizeLimit = (value, fallback = 20) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(MAX_LIMIT, parsed);
};

const sanitizePage = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
};

const countLessons = (course = {}) => (
    (Array.isArray(course.modules) ? course.modules : [])
        .reduce((sum, moduleItem) => sum + (Array.isArray(moduleItem?.lessons) ? moduleItem.lessons.length : 0), 0)
);

const asCourseDto = (course = {}) => ({
    id: String(course._id),
    title: course.title,
    description: course.description || '',
    modules: Array.isArray(course.modules) ? course.modules : [],
    level: course.level || 'beginner',
    duration: course.duration || '',
    lessonCount: countLessons(course),
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
});

const canManageCourses = (user = {}) => {
    if (Boolean(user.isAdmin)) return true;
    return String(user.activeRole || user.primaryRole || '').toLowerCase() === 'employer';
};

const ensureCourseAccess = async (courseId) => {
    const course = await Course.findById(courseId);
    if (!course || !course.isPublished) return null;
    return course;
};

router.get('/courses', protect, async (req, res) => {
    try {
        const page = sanitizePage(req.query.page);
        const limit = sanitizeLimit(req.query.limit, 20);
        const skip = (page - 1) * limit;

        const [rows, total] = await Promise.all([
            Course.find({ isPublished: true })
                .sort({ createdAt: -1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Course.countDocuments({ isPublished: true }),
        ]);

        return res.json({
            courses: rows.map(asCourseDto),
            page,
            limit,
            total,
            hasMore: (page * limit) < total,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load courses' });
    }
});

router.post('/courses', protect, async (req, res) => {
    try {
        if (!canManageCourses(req.user)) {
            return res.status(403).json({ message: 'Only employer mode can publish academy courses' });
        }

        const title = String(req.body?.title || '').trim();
        if (!title) {
            return res.status(400).json({ message: 'title is required' });
        }

        const modules = Array.isArray(req.body?.modules) ? req.body.modules : [];
        const normalizedModules = modules.map((moduleItem, moduleIndex) => ({
            moduleId: String(moduleItem?.moduleId || `module-${moduleIndex + 1}`).trim(),
            title: sanitizeText(moduleItem?.title || `Module ${moduleIndex + 1}`, { maxLength: 120 }),
            order: Number.isFinite(Number(moduleItem?.order)) ? Number(moduleItem.order) : moduleIndex,
            lessons: (Array.isArray(moduleItem?.lessons) ? moduleItem.lessons : []).map((lesson, lessonIndex) => ({
                lessonId: String(lesson?.lessonId || `lesson-${moduleIndex + 1}-${lessonIndex + 1}`).trim(),
                title: sanitizeText(lesson?.title || `Lesson ${lessonIndex + 1}`, { maxLength: 180 }),
                content: sanitizeText(lesson?.content || '', { maxLength: 20000 }),
                durationMinutes: Number.isFinite(Number(lesson?.durationMinutes)) ? Number(lesson.durationMinutes) : 0,
                order: Number.isFinite(Number(lesson?.order)) ? Number(lesson.order) : lessonIndex,
            })),
        }));

        const course = await Course.create({
            title: sanitizeText(title, { maxLength: 120 }),
            description: sanitizeText(req.body?.description || '', { maxLength: 4000 }),
            modules: normalizedModules,
            level: ['beginner', 'intermediate', 'advanced'].includes(String(req.body?.level || '').toLowerCase())
                ? String(req.body.level).toLowerCase()
                : 'beginner',
            duration: sanitizeText(req.body?.duration || '', { maxLength: 40 }),
            isPublished: req.body?.isPublished !== false,
        });

        await Post.create({
            user: req.user._id,
            authorId: req.user._id,
            postType: 'academy',
            type: 'academy',
            visibility: 'public',
            content: `New academy course: ${course.title}`,
            media: [],
            mediaUrl: '',
            trustWeight: Number(req.user?.isVerified ? 0.2 : 0) + Number(req.user?.hasCompletedProfile ? 0.1 : 0),
            meta: {
                courseId: String(course._id),
            },
        }).catch(() => {});

        return res.status(201).json({
            course: asCourseDto(course.toObject()),
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to create course' });
    }
});

router.get('/courses/:id', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid course id' });
        }
        const course = await ensureCourseAccess(req.params.id);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }
        return res.json({ course: asCourseDto(course.toObject()) });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load course' });
    }
});

router.post('/courses/:id/enroll', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid course id' });
        }
        const course = await ensureCourseAccess(req.params.id);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        const progress = await UserCourseProgress.findOneAndUpdate(
            {
                userId: req.user._id,
                courseId: course._id,
            },
            {
                $setOnInsert: {
                    startedAt: new Date(),
                    completedLessonIds: [],
                    progressPercent: 0,
                    completedAt: null,
                },
                $set: {
                    lastAccessedAt: new Date(),
                },
            },
            {
                upsert: true,
                new: true,
            }
        );

        return res.status(201).json({
            enrollment: progress,
            course: asCourseDto(course.toObject()),
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to enroll in course' });
    }
});

router.post('/courses/:id/lessons/:lessonId/complete', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid course id' });
        }
        const course = await ensureCourseAccess(req.params.id);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        const lessonId = String(req.params.lessonId || '').trim();
        if (!lessonId) {
            return res.status(400).json({ message: 'lessonId is required' });
        }

        const totalLessons = Math.max(1, countLessons(course));
        const progress = await UserCourseProgress.findOneAndUpdate(
            {
                userId: req.user._id,
                courseId: course._id,
            },
            {
                $addToSet: { completedLessonIds: lessonId },
                $set: {
                    lastLessonId: lessonId,
                    lastAccessedAt: new Date(),
                },
                $setOnInsert: {
                    startedAt: new Date(),
                },
            },
            {
                upsert: true,
                new: true,
            }
        );

        const completedCount = new Set(progress.completedLessonIds || []).size;
        progress.progressPercent = Math.min(100, Math.round((completedCount / totalLessons) * 100));
        if (progress.progressPercent >= 100 && !progress.completedAt) {
            progress.completedAt = new Date();
        }
        await progress.save();

        return res.json({
            success: true,
            progress,
            courseId: String(course._id),
            lessonId,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to update lesson progress' });
    }
});

router.get('/enrolled', protect, async (req, res) => {
    try {
        const rows = await UserCourseProgress.find({ userId: req.user._id })
            .sort({ updatedAt: -1 })
            .lean();
        const courseIds = rows.map((row) => row.courseId);
        const courses = await Course.find({ _id: { $in: courseIds } }).lean();
        const courseMap = new Map(courses.map((course) => [String(course._id), asCourseDto(course)]));

        const enrolled = rows.map((row) => ({
            ...row,
            courseId: String(row.courseId),
            course: courseMap.get(String(row.courseId)) || null,
        }));

        return res.json({ enrolled });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load enrolled courses' });
    }
});

module.exports = router;
