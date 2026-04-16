const mongoose = require('mongoose');

const lessonSchema = new mongoose.Schema({
    lessonId: {
        type: String,
        required: true,
        trim: true,
    },
    title: {
        type: String,
        required: true,
        trim: true,
    },
    content: {
        type: String,
        default: '',
        trim: true,
    },
    durationMinutes: {
        type: Number,
        default: 0,
    },
    order: {
        type: Number,
        default: 0,
    },
}, { _id: false });

const moduleSchema = new mongoose.Schema({
    moduleId: {
        type: String,
        required: true,
        trim: true,
    },
    title: {
        type: String,
        required: true,
        trim: true,
    },
    order: {
        type: Number,
        default: 0,
    },
    lessons: {
        type: [lessonSchema],
        default: [],
    },
}, { _id: false });

const courseSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true,
    },
    description: {
        type: String,
        default: '',
        trim: true,
    },
    modules: {
        type: [moduleSchema],
        default: [],
    },
    level: {
        type: String,
        enum: ['beginner', 'intermediate', 'advanced'],
        default: 'beginner',
    },
    duration: {
        type: String,
        default: '',
        trim: true,
    },
    isPublished: {
        type: Boolean,
        default: true,
        index: true,
    },
}, {
    timestamps: true,
});

courseSchema.index({ isPublished: 1, createdAt: -1 });

module.exports = mongoose.model('Course', courseSchema);

