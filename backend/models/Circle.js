const mongoose = require('mongoose');

const circleSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    description: {
        type: String,
        default: '',
        trim: true,
    },
    category: {
        type: String,
        default: 'general',
        trim: true,
        index: true,
    },
    skill: {
        type: String,
        default: '',
        trim: true,
    },
    location: {
        type: String,
        default: '',
        trim: true,
    },
    members: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    }],
    memberIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    }],
    adminIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    }],
    privacy: {
        type: String,
        enum: ['public', 'request_only', 'private'],
        default: 'public',
        index: true,
    },
    joinRequests: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending',
        },
        requestedAt: {
            type: Date,
            default: Date.now,
        },
        reviewedAt: {
            type: Date,
            default: null,
        },
    }],
    moderationQueue: [{
        targetType: {
            type: String,
            enum: ['post', 'member', 'message'],
            default: 'post',
        },
        targetId: {
            type: String,
            required: true,
        },
        reason: {
            type: String,
            default: '',
        },
        reportedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        status: {
            type: String,
            enum: ['pending', 'resolved', 'dismissed'],
            default: 'pending',
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
        resolvedAt: {
            type: Date,
            default: null,
        },
        moderatorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    }],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    isPrivate: {
        type: Boolean,
        default: false,
    },
    avatar: {
        type: String,
        default: '',
    },
}, {
    timestamps: true,
});

circleSchema.pre('save', function preSaveCircle(next) {
    const members = Array.isArray(this.members) ? this.members.map((id) => String(id)) : [];
    const memberIds = Array.isArray(this.memberIds) ? this.memberIds.map((id) => String(id)) : [];
    const mergedMembers = Array.from(new Set([...members, ...memberIds, String(this.createdBy)]));
    this.members = mergedMembers;
    this.memberIds = mergedMembers;

    const adminIds = Array.isArray(this.adminIds) ? this.adminIds.map((id) => String(id)) : [];
    const mergedAdmins = Array.from(new Set([...adminIds, String(this.createdBy)]));
    this.adminIds = mergedAdmins;

    if (this.isPrivate && this.privacy === 'public') {
        this.privacy = 'private';
    }
    if (this.privacy === 'private') {
        this.isPrivate = true;
    } else if (this.isPrivate && this.privacy !== 'private') {
        this.privacy = 'request_only';
    }

    if (typeof next === 'function') {
        return next();
    }
    return undefined;
});

circleSchema.index({ createdAt: -1 });
circleSchema.index({ location: 1, skill: 1 });
circleSchema.index({ privacy: 1, category: 1, createdAt: -1 });
circleSchema.index({ memberIds: 1, createdAt: -1 });

module.exports = mongoose.model('Circle', circleSchema);
