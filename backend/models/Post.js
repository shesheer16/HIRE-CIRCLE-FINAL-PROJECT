const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    text: {
        type: String,
        required: true,
        trim: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
}, { _id: true });

const mediaItemSchema = new mongoose.Schema({
    url: {
        type: String,
        required: true,
        trim: true,
    },
    mimeType: {
        type: String,
        default: '',
        trim: true,
    },
    sizeBytes: {
        type: Number,
        default: null,
    },
}, { _id: false });

const LEGACY_TYPES = new Set(['text', 'voice', 'photo', 'video']);
const PLATFORM_POST_TYPES = new Set(['job', 'bounty', 'community', 'academy', 'status']);

const postSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    authorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true,
    },
    postType: {
        type: String,
        enum: ['job', 'bounty', 'community', 'academy', 'status'],
        default: 'status',
        index: true,
    },
    type: {
        type: String,
        enum: ['text', 'voice', 'photo', 'video', 'job', 'bounty', 'community', 'academy', 'status'],
        default: 'status',
    },
    content: {
        type: String,
        default: '',
        trim: true,
    },
    media: {
        type: [mediaItemSchema],
        default: [],
    },
    mediaUrl: {
        type: String,
        default: '',
    },
    visibility: {
        type: String,
        enum: ['public', 'connections', 'community', 'private'],
        default: 'public',
        index: true,
    },
    engagementScore: {
        type: Number,
        default: 0,
        index: true,
    },
    interactionWeight: {
        type: Number,
        default: 0,
    },
    trustWeight: {
        type: Number,
        default: 0,
    },
    interactionCount: {
        type: Number,
        default: 0,
    },
    rankingVersion: {
        type: String,
        default: 'deterministic_v1',
    },
    meta: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point',
        },
        coordinates: {
            type: [Number],
            default: [0, 0],
        },
    },
    likes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    }],
    vouches: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    }],
    comments: [commentSchema],
}, {
    timestamps: true,
});

postSchema.pre('validate', function preValidatePost(next) {
    if (!this.authorId && this.user) {
        this.authorId = this.user;
    }
    if (!this.user && this.authorId) {
        this.user = this.authorId;
    }

    const normalizedType = String(this.type || '').trim().toLowerCase();
    const normalizedPostType = String(this.postType || '').trim().toLowerCase();

    if (PLATFORM_POST_TYPES.has(normalizedType) && !normalizedPostType) {
        this.postType = normalizedType;
    }
    if (!PLATFORM_POST_TYPES.has(normalizedPostType)) {
        this.postType = 'status';
    }

    if (!normalizedType) {
        this.type = 'status';
    }
    if (PLATFORM_POST_TYPES.has(String(this.postType || '').toLowerCase()) && !LEGACY_TYPES.has(normalizedType)) {
        this.type = this.postType;
    }

    if (this.mediaUrl && (!Array.isArray(this.media) || this.media.length === 0)) {
        this.media = [{ url: this.mediaUrl }];
    }

    if (typeof next === 'function') {
        next();
    }
});

postSchema.pre('save', function preSavePost(next) {
    const likeCount = Array.isArray(this.likes) ? this.likes.length : 0;
    const commentCount = Array.isArray(this.comments) ? this.comments.length : 0;
    const vouchCount = Array.isArray(this.vouches) ? this.vouches.length : 0;
    const interactionCount = likeCount + (commentCount * 2) + (vouchCount * 2);

    this.interactionCount = interactionCount;
    this.interactionWeight = Number((Math.min(1, interactionCount / 50)).toFixed(4));
    this.engagementScore = Number((this.interactionWeight + Number(this.trustWeight || 0)).toFixed(4));
    if (typeof next === 'function') {
        next();
    }
});

postSchema.index({ createdAt: -1 });
postSchema.index({ location: '2dsphere' });
postSchema.index({ visibility: 1, postType: 1, createdAt: -1, engagementScore: -1 });
postSchema.index({ authorId: 1, createdAt: -1 });
postSchema.index({ postType: 1, 'meta.jobId': 1 });

module.exports = mongoose.model('Post', postSchema);
