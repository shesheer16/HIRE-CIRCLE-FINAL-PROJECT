const mongoose = require('mongoose');

const smartInterviewDatasetSchema = mongoose.Schema(
    {
        anonymousWorkerKey: {
            type: String,
            required: true,
            index: true,
        },
        role: {
            type: String,
            required: true,
            index: true,
        },
        city: {
            type: String,
            default: 'unknown',
            index: true,
        },
        salary: {
            type: Number,
            default: null,
            index: true,
        },
        experienceYears: {
            type: Number,
            default: null,
            index: true,
        },
        hireOutcome: {
            type: String,
            enum: ['unknown', 'shortlisted', 'hired', 'rejected'],
            default: 'unknown',
            index: true,
        },
        profileQualityScore: {
            type: Number,
            default: null,
            index: true,
        },
        communicationClarityScore: {
            type: Number,
            default: null,
        },
        confidenceLanguageScore: {
            type: Number,
            default: null,
        },
        salaryOutlierFlag: {
            type: Boolean,
            default: false,
            index: true,
        },
        source: {
            type: String,
            default: 'smart_interview_v4',
            index: true,
        },
        capturedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
        collection: 'smart_interview_dataset',
    }
);

smartInterviewDatasetSchema.index({ role: 1, city: 1, capturedAt: -1 });
smartInterviewDatasetSchema.index({ hireOutcome: 1, capturedAt: -1 });

module.exports = mongoose.model('SmartInterviewDataset', smartInterviewDatasetSchema);
