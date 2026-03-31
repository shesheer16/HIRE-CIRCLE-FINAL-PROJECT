const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');
const Course = require('../models/Course');
const UserCourseProgress = require('../models/UserCourseProgress');
const AcademyMentorRequest = require('../models/AcademyMentorRequest');
const Post = require('../models/Post');
const WorkerProfile = require('../models/WorkerProfile');
const { guardedGeminiGenerateText, parseStrictJsonObject } = require('../services/aiGuardrailService');
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

const toBoundedNumber = (value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) => {
    const parsed = Number.parseFloat(String(value ?? '').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

const toMentorId = (name, skill, index) => {
    const slug = `${String(name || '').toLowerCase()}-${String(skill || '').toLowerCase()}`
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 36);
    return slug ? `mentor-ai-${slug}` : `mentor-ai-${index + 1}`;
};

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

router.get('/mentor-match', protect, async (req, res) => {
    try {
        const workerProfile = await WorkerProfile.findOne({ user: req.user._id }).lean();
        const primaryRole = String(
            workerProfile?.roleProfiles?.[0]?.roleName
            || workerProfile?.roleProfiles?.[0]?.title
            || req.user?.currentRole
            || 'General Worker'
        ).trim();
        const city = String(workerProfile?.city || req.user?.city || 'India').trim();
        const totalExperience = toBoundedNumber(
            workerProfile?.totalExperience ?? workerProfile?.roleProfiles?.[0]?.experienceInRole ?? 0,
            { min: 0, max: 40, fallback: 0 }
        );
        const roleSkills = (Array.isArray(workerProfile?.roleProfiles?.[0]?.skills) ? workerProfile.roleProfiles[0].skills : [])
            .map((skill) => sanitizeText(String(skill || ''), { maxLength: 48 }))
            .filter(Boolean)
            .slice(0, 8);

        const mentorPrompt = [
            'You are an AI mentor matching engine for frontline careers.',
            'Return JSON only in this exact structure:',
            '{',
            '  "mentors": [',
            '    {',
            '      "name": "string",',
            '      "expYears": number,',
            '      "skill": "string",',
            '      "rating": number,',
            '      "sessions": number,',
            '      "reason": "string"',
            '    }',
            '  ]',
            '}',
            '',
            'Rules:',
            '- Return exactly 4 mentors.',
            '- Keep names realistic and professional.',
            '- skill must be short (1-4 words).',
            '- rating must be between 4.0 and 5.0.',
            '- sessions must be between 40 and 2000.',
            '- reason must be one concise sentence (max 18 words).',
            '- Do not include markdown fences.',
            '',
            'Worker context:',
            JSON.stringify({
                role: primaryRole,
                city,
                totalExperience,
                skills: roleSkills,
            }),
        ].join('\n');

        const rawResponse = await guardedGeminiGenerateText({
            prompt: mentorPrompt,
            rateLimitKey: `academy_mentor_match:${String(req.user._id || 'unknown')}`,
            model: process.env.SMART_INTERVIEW_GEMINI_MODEL || process.env.AI_DEFAULT_MODEL || 'gemini-2.0-flash',
            temperature: 0.35,
            timeoutMs: Number.parseInt(process.env.GEMINI_TEXT_TIMEOUT_MS || '9000', 10),
            maxOutputTokens: 900,
        });
        const parsed = parseStrictJsonObject(rawResponse);
        const rawMentors = Array.isArray(parsed?.mentors) ? parsed.mentors : [];

        const mentors = rawMentors
            .slice(0, 6)
            .map((mentor, index) => {
                const name = sanitizeText(String(mentor?.name || ''), { maxLength: 64 }) || `Mentor ${index + 1}`;
                const skill = sanitizeText(String(mentor?.skill || ''), { maxLength: 48 }) || 'Career Growth';
                const expYears = Math.round(toBoundedNumber(mentor?.expYears, { min: 2, max: 35, fallback: 6 }));
                const ratingNumber = toBoundedNumber(mentor?.rating, { min: 4, max: 5, fallback: 4.6 });
                const sessionCount = Math.round(toBoundedNumber(mentor?.sessions, { min: 40, max: 2000, fallback: 120 }));
                const reason = sanitizeText(String(mentor?.reason || ''), { maxLength: 180 }) || 'Great fit for your current growth stage.';

                return {
                    id: toMentorId(name, skill, index),
                    name,
                    exp: `${expYears}y`,
                    skill,
                    rating: ratingNumber.toFixed(1),
                    sessions: String(sessionCount),
                    reason,
                    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=8b3dff&color=fff&rounded=true`,
                };
            });

        return res.json({
            mentors,
            generatedAt: new Date().toISOString(),
            source: 'gemini',
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load AI mentor match' });
    }
});

router.get('/mentor-requests', protect, async (req, res) => {
    try {
        const requests = await AcademyMentorRequest.find({ userId: req.user._id })
            .sort({ updatedAt: -1, _id: 1 })
            .lean();

        return res.json({
            requests: requests.map((request) => ({
                id: String(request._id),
                mentorId: String(request.mentorId || ''),
                mentorName: String(request.mentorName || ''),
                mentorSkill: String(request.mentorSkill || ''),
                status: String(request.status || 'requested'),
                source: String(request.source || 'academy_ai_match'),
                updatedAt: request.updatedAt || null,
                createdAt: request.createdAt || null,
            })),
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to load mentor requests' });
    }
});

router.post('/mentor-requests', protect, async (req, res) => {
    try {
        const mentorId = String(req.body?.mentorId || '').trim();
        if (!mentorId) {
            return res.status(400).json({ message: 'mentorId is required' });
        }

        const mentorName = sanitizeText(String(req.body?.mentorName || ''), { maxLength: 80 });
        const mentorSkill = sanitizeText(String(req.body?.mentorSkill || ''), { maxLength: 64 });
        const source = sanitizeText(String(req.body?.source || 'academy_ai_match'), { maxLength: 40 }) || 'academy_ai_match';

        const request = await AcademyMentorRequest.findOneAndUpdate(
            {
                userId: req.user._id,
                mentorId,
            },
            {
                $setOnInsert: {
                    userId: req.user._id,
                    mentorId,
                    mentorName,
                    mentorSkill,
                    source,
                    status: 'requested',
                },
                $set: {
                    mentorName,
                    mentorSkill,
                    source,
                    updatedAt: new Date(),
                },
            },
            {
                upsert: true,
                new: true,
            }
        ).lean();

        return res.status(201).json({
            request: {
                id: String(request._id),
                mentorId: String(request.mentorId || ''),
                mentorName: String(request.mentorName || ''),
                mentorSkill: String(request.mentorSkill || ''),
                status: String(request.status || 'requested'),
                source: String(request.source || 'academy_ai_match'),
                updatedAt: request.updatedAt || null,
                createdAt: request.createdAt || null,
            },
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to request mentor connect' });
    }
});

module.exports = router;
