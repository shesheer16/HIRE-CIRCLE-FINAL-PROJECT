const mongoose = require('mongoose');

const JOB_STATUS_ENUM = Object.freeze([
    'DRAFT',
    'OPEN',
    'PAUSED',
    'FILLED',
    'CLOSED',
    'ARCHIVED',
    'EXPIRED',
]);

const LEGACY_TO_CANONICAL_STATUS = Object.freeze({
    draft_from_ai: 'DRAFT',
    draft: 'DRAFT',
    active: 'OPEN',
    open: 'OPEN',
    paused: 'PAUSED',
    filled: 'FILLED',
    closed: 'CLOSED',
    archived: 'ARCHIVED',
    expired: 'EXPIRED',
});

const normalizeJobStatus = (value, fallback = 'OPEN') => {
    const raw = String(value || '').trim();
    if (!raw) return fallback;

    const upper = raw.toUpperCase();
    if (JOB_STATUS_ENUM.includes(upper)) return upper;

    const mapped = LEGACY_TO_CANONICAL_STATUS[raw.toLowerCase()];
    if (mapped) return mapped;

    return fallback;
};

const expandStatusToOperands = (canonical) => {
    if (!canonical) return [];
    const legacyValues = Object.entries(LEGACY_TO_CANONICAL_STATUS)
        .filter(([, mapped]) => mapped === canonical)
        .map(([legacy]) => legacy);
    return Array.from(new Set([canonical, ...legacyValues]));
};

const normalizeStatusOperand = (value) => {
    if (typeof value === 'string') {
        const canonical = normalizeJobStatus(value, null);
        if (!canonical) return value;
        const operands = expandStatusToOperands(canonical);
        return operands.length === 1 ? operands[0] : { $in: operands };
    }

    if (Array.isArray(value)) {
        return Array.from(new Set(
            value
                .map((entry) => normalizeJobStatus(entry, null))
                .filter(Boolean)
        ));
    }

    if (value && typeof value === 'object') {
        const next = { ...value };
        if (Array.isArray(next.$in)) {
            next.$in = Array.from(new Set(
                next.$in
                    .map((entry) => normalizeJobStatus(entry, null))
                    .filter(Boolean)
            ));
        }
        if (Array.isArray(next.$nin)) {
            next.$nin = Array.from(new Set(
                next.$nin
                    .map((entry) => normalizeJobStatus(entry, null))
                    .filter(Boolean)
            ));
        }
        if (typeof next.$eq === 'string') {
            next.$eq = normalizeJobStatus(next.$eq, next.$eq);
        }
        return next;
    }

    return value;
};

const normalizeStatusFiltersDeep = (input) => {
    if (!input || typeof input !== 'object') return input;
    if (Array.isArray(input)) {
        return input.map((entry) => normalizeStatusFiltersDeep(entry));
    }

    const rawBuffer = input?.buffer;
    if (rawBuffer && typeof rawBuffer === 'object') {
        const bytes = [];
        for (let i = 0; i < 12; i += 1) {
            const next = rawBuffer[i] ?? rawBuffer[String(i)];
            const parsed = Number(next);
            if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
                bytes.length = 0;
                break;
            }
            bytes.push(parsed);
        }
        if (bytes.length === 12) {
            return new mongoose.Types.ObjectId(Buffer.from(bytes).toString('hex'));
        }
    }

    let toHexStringLooksLikeObjectId = false;
    if (typeof input?.toHexString === 'function') {
        try {
            const hex = String(input.toHexString() || '');
            toHexStringLooksLikeObjectId = mongoose.Types.ObjectId.isValid(hex);
        } catch (_error) {
            toHexStringLooksLikeObjectId = false;
        }
    }
    const isObjectIdLike = (
        input instanceof mongoose.Types.ObjectId
        || toHexStringLooksLikeObjectId
        || String(input?._bsontype || '').toLowerCase().includes('objectid')
    );
    if (isObjectIdLike || input instanceof Date || input instanceof RegExp || Buffer.isBuffer(input)) {
        return input;
    }

    const proto = Object.getPrototypeOf(input);
    const isPlainObject = proto === Object.prototype || proto === null;
    if (!isPlainObject) {
        return input;
    }

    const output = {};
    for (const [key, value] of Object.entries(input)) {
        if (key === 'status') {
            output[key] = normalizeStatusOperand(value);
            continue;
        }
        if (value && typeof value === 'object') {
            output[key] = normalizeStatusFiltersDeep(value);
            continue;
        }
        output[key] = value;
    }
    return output;
};

const isOpenForStatus = (status) => status === 'OPEN';

const jobSchema = mongoose.Schema(
    {
        employerId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'User',
        },
        title: {
            type: String,
            required: [true, 'Please add a job title'],
        },
        companyName: {
            type: String,
            required: [true, 'Please add a company name'],
        },
        salaryRange: {
            type: String,
            required: [true, 'Please add a salary range'],
        },
        location: {
            type: String,
            required: [true, 'Please add a location'],
        },
        district: {
            type: String,
            default: null,
            index: true,
        },
        mandal: {
            type: String,
            default: null,
            index: true,
        },
        locationLabel: {
            type: String,
            default: null,
        },
        geo: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point',
            },
            coordinates: {
                type: [Number],
                default: [0, 0], // [longitude, latitude]
            },
        },
        country: {
            type: String,
            default: 'IN',
            uppercase: true,
            index: true,
        },
        region: {
            type: String,
            default: 'IN-GENERAL',
            uppercase: true,
            index: true,
        },
        countryCode: {
            type: String,
            default: 'IN',
            uppercase: true,
            index: true,
        },
        regionCode: {
            type: String,
            default: 'IN-GENERAL',
            index: true,
        },
        currencyCode: {
            type: String,
            default: 'INR',
            uppercase: true,
        },
        languageCode: {
            type: String,
            default: 'en-IN',
        },
        requirements: [
            {
                type: String,
            },
        ],
        screeningQuestions: [
            {
                type: String,
            },
        ],
        minSalary: {
            type: Number, // Extracted from salaryRange or default
        },
        maxSalary: {
            type: Number, // Extracted from salaryRange or default
        },
        shift: {
            type: String,
            enum: ['Day', 'Night', 'Flexible'],
            default: 'Flexible',
        },
        mandatoryLicenses: [
            {
                type: String, // e.g., "Heavy Vehicle", "Commercial"
            },
        ],
        openings: {
            type: Number,
            min: 0,
            default: null,
        },
        remoteAllowed: {
            type: Boolean,
            default: false,
            index: true,
        },
        isPulse: {
            type: Boolean,
            default: false,
        },
        viewCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        isOpen: {
            type: Boolean,
            default: true,
        },
        expiresAt: {
            type: Date,
            default: function defaultExpiryAt() {
                const expiryDays = Number.parseInt(process.env.JOB_DEFAULT_EXPIRY_DAYS || '30', 10);
                return new Date(Date.now() + (Math.max(1, expiryDays) * 24 * 60 * 60 * 1000));
            },
            index: true,
        },
        closedAt: {
            type: Date,
            default: null,
        },
        closedReason: {
            type: String,
            default: null,
        },
        isDisabled: {
            type: Boolean,
            default: false,
            index: true,
        },
        disabledAt: {
            type: Date,
            default: null,
        },
        disabledReason: {
            type: String,
            default: null,
        },
        priorityListing: {
            type: Boolean,
            default: false,
            index: true,
        },
        enterpriseWorkspaceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'EnterpriseWorkspace',
            default: null,
            index: true,
        },
        enterpriseIsolationKey: {
            type: String,
            default: null,
            index: true,
        },
        status: {
            type: String,
            enum: JOB_STATUS_ENUM,
            default: 'OPEN',
            index: true,
        },
        workflowState: {
            type: String,
            enum: ['open', 'in_progress', 'completed'],
            default: 'open',
            index: true,
        },
        isArchived: {
            type: Boolean,
            default: false,
            index: true,
        },
        archivedAt: {
            type: Date,
            default: null,
            index: true,
        },
        updated_at: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
jobSchema.index({ employerId: 1 });
jobSchema.index({ createdAt: -1 });
jobSchema.index({ location: 1 });
jobSchema.index({ district: 1, mandal: 1 });
jobSchema.index({ geo: '2dsphere' }); // Map indexing
jobSchema.index({ minSalary: 1, maxSalary: 1 });
jobSchema.index({ isOpen: 1 });
jobSchema.index({ isOpen: 1, location: 1 });
jobSchema.index({ isOpen: 1, district: 1, mandal: 1 });
jobSchema.index({ country: 1, region: 1, remoteAllowed: 1, createdAt: -1 });
jobSchema.index({ countryCode: 1, regionCode: 1, createdAt: -1 });
jobSchema.index({ employerId: 1, status: 1, createdAt: -1 });
jobSchema.index({ status: 1, viewCount: -1, createdAt: -1 });
jobSchema.index({ enterpriseWorkspaceId: 1, status: 1, createdAt: -1 });
jobSchema.index({ enterpriseIsolationKey: 1, createdAt: -1 });
jobSchema.index({ status: 1, isArchived: 1, updatedAt: -1 });
jobSchema.index({ workflowState: 1, status: 1, isArchived: 1 });
jobSchema.index({ status: 1, isOpen: 1, expiresAt: 1 });
jobSchema.index({ status: 1, updated_at: -1 });

jobSchema.pre('validate', function normalizeGeographyAndStatus(next) {
    const normalizedCountry = String(this.country || this.countryCode || 'IN').trim().toUpperCase() || 'IN';
    const normalizedRegion = String(this.region || this.regionCode || `${normalizedCountry}-GENERAL`).trim().toUpperCase()
        || `${normalizedCountry}-GENERAL`;

    this.country = normalizedCountry;
    this.region = normalizedRegion;
    this.countryCode = normalizedCountry;
    this.regionCode = normalizedRegion;

    // Validate geo coordinates
    if (this.geo && this.geo.coordinates) {
        if (!Array.isArray(this.geo.coordinates) || this.geo.coordinates.length !== 2) {
            this.geo.coordinates = [0, 0];
        } else {
            const lng = Number(this.geo.coordinates[0]);
            const lat = Number(this.geo.coordinates[1]);
            if (!Number.isFinite(lng) || !Number.isFinite(lat) ||
                lng < -180 || lng > 180 || lat < -90 || lat > 90) {
                this.geo.coordinates = [0, 0];
            } else {
                this.geo.coordinates = [lng, lat];
            }
        }
    }

    const fallbackStatus = this.isOpen === false ? 'PAUSED' : 'OPEN';
    this.status = normalizeJobStatus(this.status, fallbackStatus);
    this.isOpen = isOpenForStatus(this.status);
    if (!this.isOpen && !this.closedAt && ['FILLED', 'CLOSED', 'ARCHIVED', 'EXPIRED'].includes(this.status)) {
        this.closedAt = new Date();
    }
    this.updated_at = new Date();

    if (typeof next === 'function') next();
});

jobSchema.pre('save', function syncUpdatedAt(next) {
    this.updated_at = new Date();
    if (typeof next === 'function') next();
});

const UPDATE_HOOKS = ['findOneAndUpdate', 'updateOne', 'updateMany'];
const QUERY_HOOKS = ['find', 'findOne', 'countDocuments', ...UPDATE_HOOKS];

QUERY_HOOKS.forEach((hook) => {
    jobSchema.pre(hook, function normalizeQueryAndUpdate(next) {
        const query = this.getQuery ? this.getQuery() : null;
        if (query && typeof query === 'object') {
            this.setQuery(normalizeStatusFiltersDeep(query));
        }

        if (UPDATE_HOOKS.includes(hook) && this.getUpdate && this.setUpdate) {
            const update = this.getUpdate() || {};
            const nextUpdate = { ...update };
            const now = new Date();

            if (typeof nextUpdate.status === 'string') {
                nextUpdate.status = normalizeJobStatus(nextUpdate.status, nextUpdate.status);
                nextUpdate.$set = { ...(nextUpdate.$set || {}), isOpen: isOpenForStatus(nextUpdate.status) };
            }

            nextUpdate.$set = { ...(nextUpdate.$set || {}) };
            if (typeof nextUpdate.$set.status === 'string') {
                nextUpdate.$set.status = normalizeJobStatus(nextUpdate.$set.status, nextUpdate.$set.status);
                nextUpdate.$set.isOpen = isOpenForStatus(nextUpdate.$set.status);
            }
            nextUpdate.$set.updated_at = now;

            this.setUpdate(nextUpdate);
        }

        if (typeof next === 'function') next();
    });
});

const Job = mongoose.model('Job', jobSchema);

Job.JOB_STATUS_ENUM = JOB_STATUS_ENUM;
Job.normalizeJobStatus = normalizeJobStatus;

module.exports = Job;
