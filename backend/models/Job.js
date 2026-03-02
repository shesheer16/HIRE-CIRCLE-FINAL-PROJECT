const mongoose = require('mongoose');

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
        geo: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point'
            },
            coordinates: {
                type: [Number],
                default: [0, 0] // [longitude, latitude]
            }
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
            default: 'Flexible'
        },
        mandatoryLicenses: [
            {
                type: String, // e.g., "Heavy Vehicle", "Commercial"
            }
        ],
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
            default: true
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
            enum: ['draft_from_ai', 'active', 'closed'],
            default: 'active',
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
        }
    },
    {
        timestamps: true,
    }
);

// Indexes
jobSchema.index({ employerId: 1 });
jobSchema.index({ createdAt: -1 });
jobSchema.index({ location: 1 });
jobSchema.index({ geo: '2dsphere' }); // Map indexing
jobSchema.index({ minSalary: 1, maxSalary: 1 });
jobSchema.index({ isOpen: 1 }); // active-state index
jobSchema.index({ isOpen: 1, location: 1 }); // Used for candidate matching
jobSchema.index({ country: 1, region: 1, remoteAllowed: 1, createdAt: -1 });
jobSchema.index({ countryCode: 1, regionCode: 1, createdAt: -1 });
jobSchema.index({ employerId: 1, status: 1, createdAt: -1 });
jobSchema.index({ status: 1, viewCount: -1, createdAt: -1 });
jobSchema.index({ enterpriseWorkspaceId: 1, status: 1, createdAt: -1 });
jobSchema.index({ enterpriseIsolationKey: 1, createdAt: -1 });
jobSchema.index({ status: 1, isArchived: 1, updatedAt: -1 });
jobSchema.index({ workflowState: 1, status: 1, isArchived: 1 });
jobSchema.index({ status: 1, isOpen: 1, expiresAt: 1 });

jobSchema.pre('validate', function normalizeGeographyFields(next) {
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

    if (typeof next === 'function') {
        next();
    }
});

module.exports = mongoose.model('Job', jobSchema);
