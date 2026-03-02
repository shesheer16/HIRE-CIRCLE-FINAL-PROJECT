const mongoose = require('mongoose');

const userCourseProgressSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    courseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: true,
        index: true,
    },
    completedLessonIds: {
        type: [String],
        default: [],
    },
    lastLessonId: {
        type: String,
        default: null,
    },
    progressPercent: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
    },
    startedAt: {
        type: Date,
        default: Date.now,
    },
    completedAt: {
        type: Date,
        default: null,
    },
    lastAccessedAt: {
        type: Date,
        default: Date.now,
    },
}, {
    timestamps: true,
});

userCourseProgressSchema.index({ userId: 1, courseId: 1 }, { unique: true });
userCourseProgressSchema.index({ userId: 1, updatedAt: -1 });

module.exports = mongoose.model('UserCourseProgress', userCourseProgressSchema);

