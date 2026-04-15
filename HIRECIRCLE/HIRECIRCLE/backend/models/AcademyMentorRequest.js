const mongoose = require('mongoose');

const academyMentorRequestSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        mentorId: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        mentorName: {
            type: String,
            default: '',
            trim: true,
        },
        mentorSkill: {
            type: String,
            default: '',
            trim: true,
        },
        status: {
            type: String,
            enum: ['requested', 'connected', 'declined'],
            default: 'requested',
        },
        source: {
            type: String,
            default: 'academy_ai_match',
            trim: true,
        },
    },
    {
        timestamps: true,
    }
);

academyMentorRequestSchema.index({ userId: 1, mentorId: 1 }, { unique: true });

module.exports = mongoose.model('AcademyMentorRequest', academyMentorRequestSchema);
