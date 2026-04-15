const mongoose = require('mongoose');

const conversionMilestoneSchema = mongoose.Schema(
    {
        employerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        city: {
            type: String,
            default: null,
            index: true,
        },
        roleCluster: {
            type: String,
            default: null,
        },
        signedUpAt: {
            type: Date,
            default: null,
        },
        firstJobDraftCreatedAt: {
            type: Date,
            default: null,
        },
        firstJobActivatedAt: {
            type: Date,
            default: null,
        },
        firstShortlistAt: {
            type: Date,
            default: null,
        },
        firstHireAt: {
            type: Date,
            default: null,
        },
        firstHiredJobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            default: null,
        },
        firstHiredApplicationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Application',
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

conversionMilestoneSchema.index({ city: 1, createdAt: -1 });

module.exports = mongoose.model('ConversionMilestone', conversionMilestoneSchema);
