const mongoose = require('mongoose');

const endorsementSchema = new mongoose.Schema(
    {
        fromUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        toUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        skill: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            maxlength: 120,
        },
        weight: {
            type: Number,
            min: 0,
            max: 100,
            required: true,
        },
        verified: {
            type: Boolean,
            default: false,
        },
        status: {
            type: String,
            enum: ['active', 'flagged', 'revoked'],
            default: 'active',
            index: true,
        },
        createdAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
    }
);

endorsementSchema.index({ fromUserId: 1, createdAt: -1 });
endorsementSchema.index({ toUserId: 1, createdAt: -1 });
endorsementSchema.index({ fromUserId: 1, toUserId: 1, skill: 1 }, { unique: true });

module.exports = mongoose.model('Endorsement', endorsementSchema);
