/**
 * ProfileVersion — Immutable version history for user profile changes.
 * INTEGRITY: Append-only. No updates or deletes allowed after creation.
 * AUDIT: Each version captures the changed fields and a full snapshot.
 */
const mongoose = require('mongoose');

const ProfileVersionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        role: {
            type: String,
            enum: ['worker', 'employer'],
            required: true,
        },
        version: {
            type: Number,
            required: true,
            min: 1,
        },
        changedFields: {
            type: [String],
            default: [],
        },
        snapshot: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },
        changeSource: {
            type: String,
            enum: ['user_edit', 'smart_interview', 'admin_correction', 'system_sync'],
            default: 'user_edit',
        },
        ipAddress: {
            type: String,
        },
        deviceId: {
            type: String,
        },
        flaggedSuspicious: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
        collection: 'profile_versions',
    }
);

// Compound unique index: one version entry per user per version number
ProfileVersionSchema.index({ userId: 1, version: 1 }, { unique: true });
ProfileVersionSchema.index({ userId: 1, createdAt: -1 });

// Immutability enforcement — disallow updates
ProfileVersionSchema.pre(['updateOne', 'findOneAndUpdate', 'update'], function (next) {
    const err = new Error('ProfileVersion records are immutable. No updates allowed.');
    err.code = 'IMMUTABLE_RECORD';
    next(err);
});

module.exports = mongoose.model('ProfileVersion', ProfileVersionSchema);
