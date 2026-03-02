const crypto = require('crypto');
const mongoose = require('mongoose');

const API_SCOPES = ['read-only', 'jobs', 'applications', 'full-access'];
const RATE_LIMIT_TIERS = ['basic', 'pro', 'enterprise'];
const LEGACY_PLAN_TYPES = ['free', 'partner', 'enterprise'];
const generateApiKeyId = () => `pk_${crypto.randomBytes(8).toString('hex')}`;

const hashApiKeyValue = (rawValue = '') => {
    const input = String(rawValue || '').trim();
    const pepper = String(process.env.API_KEY_HASH_PEPPER || '');
    return crypto.createHash('sha256').update(`${pepper}:${input}`).digest('hex');
};

const toKeyPrefix = (value = '') => String(value || '').trim().slice(0, 12);

const resolveRateLimitTierFromLegacy = (legacyTier = 'free') => {
    const normalized = String(legacyTier || 'free').trim().toLowerCase();
    if (normalized === 'partner') return 'pro';
    if (normalized === 'enterprise') return 'enterprise';
    return 'basic';
};

const apiKeySchema = mongoose.Schema({
    keyId: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: generateApiKeyId,
    },
    key: {
        type: String,
        unique: true,
        sparse: true,
        index: true,
        required: true,
        select: false,
    },
    keyPrefix: {
        type: String,
        required: false,
        index: true,
    },
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true,
        required: false,
    },
    scope: {
        type: String,
        enum: API_SCOPES,
        default: 'read-only',
        index: true,
    },
    revoked: {
        type: Boolean,
        default: false,
        index: true,
    },
    revokedAt: {
        type: Date,
        default: null,
    },
    rateLimitTier: {
        type: String,
        enum: RATE_LIMIT_TIERS,
        default: 'basic',
        index: true,
    },
    label: {
        type: String,
        default: 'External API Key',
    },
    // Legacy compatibility fields (do not remove; still referenced in existing flows)
    employerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false,
    },
    organization: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Organization',
        default: null,
        index: true,
    },
    keyPattern: {
        type: String,
        required: false,
        unique: true,
        sparse: true,
        index: true,
    },
    planType: {
        type: String,
        enum: LEGACY_PLAN_TYPES,
        default: 'free',
        index: true,
    },
    tier: {
        type: String,
        enum: LEGACY_PLAN_TYPES,
        default: 'free',
    },
    rateLimit: {
        type: Number,
        default: null,
        min: 1,
    },
    usageCount: {
        type: Number,
        default: 0,
    },
    requestsToday: {
        type: Number,
        default: 0,
    },
    lastResetDate: {
        type: Date,
        default: Date.now,
    },
    lastUsedAt: {
        type: Date,
        default: null,
    },
    allowedDomains: {
        type: [String],
        default: [],
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true,
    },
    usageMetrics: {
        totalCalls: {
            type: Number,
            default: 0,
            min: 0,
        },
        successfulCalls: {
            type: Number,
            default: 0,
            min: 0,
        },
        failedCalls: {
            type: Number,
            default: 0,
            min: 0,
        },
        abuseSignals: {
            type: Number,
            default: 0,
            min: 0,
        },
        burstViolations: {
            type: Number,
            default: 0,
            min: 0,
        },
        lastCallAt: {
            type: Date,
            default: null,
        },
    },
}, { timestamps: true });

apiKeySchema.pre('save', function normalizeApiKeyFields(next) {
    if (!this.keyId) {
        this.keyId = generateApiKeyId();
    }

    if (!this.ownerId && this.employerId) {
        this.ownerId = this.employerId;
    }
    if (!this.employerId && this.ownerId) {
        this.employerId = this.ownerId;
    }

    if (!this.keyPrefix && this.keyPattern) {
        this.keyPrefix = toKeyPrefix(this.keyPattern);
    }
    if (!this.keyPrefix && this.key) {
        this.keyPrefix = toKeyPrefix(this.keyPattern || this.key);
    }

    if (!this.planType && this.tier) {
        this.planType = this.tier;
    }
    if (!this.tier && this.planType) {
        this.tier = this.planType;
    }
    if (!this.rateLimitTier) {
        this.rateLimitTier = resolveRateLimitTierFromLegacy(this.planType || this.tier);
    }

    if (this.isModified('key')) {
        const normalizedKey = String(this.key || '').trim();
        const alreadyHashed = /^[a-f0-9]{64}$/i.test(normalizedKey);
        if (normalizedKey && !alreadyHashed) {
            this.key = hashApiKeyValue(normalizedKey);
        }
    }

    if (this.revoked || this.isActive === false) {
        this.revoked = true;
        this.isActive = false;
        if (!this.revokedAt) {
            this.revokedAt = new Date();
        }
    }

    next();
});

apiKeySchema.statics.API_SCOPES = API_SCOPES;
apiKeySchema.statics.RATE_LIMIT_TIERS = RATE_LIMIT_TIERS;
apiKeySchema.statics.hashApiKeyValue = hashApiKeyValue;
apiKeySchema.statics.generateApiKeyId = generateApiKeyId;

module.exports = mongoose.model('ApiKey', apiKeySchema);
