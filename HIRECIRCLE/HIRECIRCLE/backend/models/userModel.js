const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { isRecruiter } = require('../utils/roleGuards');
const { mapLocationToRegion, normalizeCountryCode } = require('../services/geoExpansionService');

const ACTIVE_ROLES = new Set(['worker', 'employer']);
const COUNTRY_LOCALE_MAP = {
  IN: { currencyCode: 'INR', languageCode: 'en-IN' },
  US: { currencyCode: 'USD', languageCode: 'en-US' },
  GB: { currencyCode: 'GBP', languageCode: 'en-GB' },
  CA: { currencyCode: 'CAD', languageCode: 'en-CA' },
  SG: { currencyCode: 'SGD', languageCode: 'en-SG' },
  AE: { currencyCode: 'AED', languageCode: 'en-AE' },
};

const normalizeActiveRole = (value, fallback = 'worker') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (ACTIVE_ROLES.has(normalized)) return normalized;
  return fallback;
};

const normalizeRolesList = (roles = []) => {
  const list = Array.isArray(roles) ? roles : [];
  const normalized = list
    .map((role) => normalizeActiveRole(role, ''))
    .filter(Boolean);
  return Array.from(new Set(normalized));
};

const resolveLegacyRoleForActiveRole = (activeRole) => (
  normalizeActiveRole(activeRole) === 'employer' ? 'recruiter' : 'candidate'
);

const resolveDefaultCapabilities = (activeRole) => {
  const normalizedRole = normalizeActiveRole(activeRole);
  return {
    canPostJob: normalizedRole === 'employer',
    canCreateCommunity: true,
    canCreateBounty: normalizedRole === 'employer',
  };
};

const normalizeRegionCode = (value, countryCode = 'IN') => {
  const normalizedCountry = normalizeCountryCode(countryCode);
  const direct = String(value || '').trim().toUpperCase();
  if (direct) return direct;
  return `${normalizedCountry}-GENERAL`;
};

const userSchema = mongoose.Schema(
  {
    // --- NEW FIELDS START ---
    name: {
      type: String,
      required: true, // Name is now mandatory
    },
    bio: {
      type: String,
      maxLength: 500,
      default: '',
    },
    role: {
      type: String,
      enum: ['candidate', 'recruiter'], // Strictly these two options
      default: 'candidate',
    },
    roles: {
      type: [String],
      enum: ['worker', 'employer'],
      default: ['worker', 'employer'],
    },
    activeRole: {
      type: String,
      enum: ['worker', 'employer'],
      default: 'worker',
      index: true,
    },
    capabilities: {
      canPostJob: {
        type: Boolean,
        default: false,
      },
      canCreateCommunity: {
        type: Boolean,
        default: true,
      },
      canCreateBounty: {
        type: Boolean,
        default: false,
      },
    },
    primaryRole: {
      type: String,
      enum: ['worker', 'employer'],
      default: function () {
        return isRecruiter(this) ? 'employer' : 'worker';
      },
    },
    hasCompletedProfile: {
      type: Boolean,
      default: false,
    },
    hasSelectedRole: {
      type: Boolean,
      default: false,
    },
    otpVerified: {
      type: Boolean,
      default: false,
    },
    profileComplete: {
      type: Boolean,
      default: false,
    },
    phoneNumber: {
      type: String,
      default: null,
    },
    city: {
      type: String,
      default: null,
    },
    state: {
      type: String,
      default: null,
      index: true,
    },
    country: {
      type: String,
      default: 'IN',
      uppercase: true,
      index: true,
    },
    regionCode: {
      type: String,
      default: 'IN-GENERAL',
      uppercase: true,
      index: true,
    },
    primaryRegion: {
      type: String,
      default: 'ap-south-1',
      index: true,
    },
    failoverRegion: {
      type: String,
      default: '',
      index: true,
    },
    timezone: {
      type: String,
      default: 'UTC',
    },
    languagePreference: {
      type: String,
      default: 'en',
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
    isExperimentUser: {
      type: Boolean,
      default: false,
      index: true,
    },
    isAdmin: {
      type: Boolean,
      default: false,
      index: true,
    },
    isBanned: {
      type: Boolean,
      default: false,
      index: true,
    },
    banReason: {
      type: String,
      default: null,
    },
    bannedAt: {
      type: Date,
      default: null,
    },
    trustScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 100,
      index: true,
    },
    responseScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 100,
      index: true,
    },
    trustStatus: {
      type: String,
      enum: ['healthy', 'watch', 'flagged', 'restricted'],
      default: 'healthy',
      index: true,
    },
    isFlagged: {
      type: Boolean,
      default: false,
      index: true,
    },
    actionLimitsUntil: {
      type: Date,
      default: null,
    },
    notificationPreferences: {
      pushEnabled: { type: Boolean, default: true },
      smsEnabled: { type: Boolean, default: false },
      emailEnabled: { type: Boolean, default: true },
      notifyNewJobRecommendations: { type: Boolean, default: true },
      notifyInterviewReady: { type: Boolean, default: true },
      notifyApplicationStatus: { type: Boolean, default: true },
      notifyPromotions: { type: Boolean, default: true },
      notifyMatch: { type: Boolean, default: true },
      notifyApplication: { type: Boolean, default: true },
      notifyHire: { type: Boolean, default: true },
    },
    privacyPreferences: {
      profileVisibleToEmployers: { type: Boolean, default: true },
      showSalaryExpectation: { type: Boolean, default: true },
      showInterviewBadge: { type: Boolean, default: true },
      showLastActive: { type: Boolean, default: true },
      allowLocationSharing: { type: Boolean, default: true },
      locationVisibilityRadiusKm: { type: Number, default: 25, min: 1, max: 200 },
    },
    featureToggles: {
      FEATURE_MATCH_UI_V1: { type: Boolean, default: true },
      FEATURE_PROBABILISTIC_MATCH: { type: Boolean, default: true },
      FEATURE_COLD_START_BOOST_SUGGESTIONS: { type: Boolean, default: false },
      FEATURE_MATCH_ALERTS: { type: Boolean, default: true },
      FEATURE_SETTINGS_ADVANCED: { type: Boolean, default: false },
      FEATURE_DETAILED_JOB_ANALYTICS: { type: Boolean, default: false },
      FEATURE_SMART_PUSH_TIMING: { type: Boolean, default: false },
    },
    globalPreferences: {
      crossBorderMatchEnabled: { type: Boolean, default: false },
      displayCurrency: {
        type: String,
        default: null,
        uppercase: true,
      },
    },
    taxProfile: {
      taxId: {
        type: String,
        default: null,
      },
      businessType: {
        type: String,
        default: null,
      },
      invoicePreference: {
        type: String,
        default: null,
      },
    },
    securitySettings: {
      twoFactorEnabled: { type: Boolean, default: false },
      twoFactorMethod: {
        type: String,
        enum: ['sms', 'email'],
        default: 'email',
      },
    },
    linkedAccounts: {
      google: { type: Boolean, default: false },
      apple: { type: Boolean, default: false },
      emailPassword: { type: Boolean, default: true },
    },
    verificationSignals: {
      govtIdVerified: {
        type: Boolean,
        default: false,
      },
      companyRegistrationVerified: {
        type: Boolean,
        default: false,
      },
      verifiedAt: {
        type: Date,
        default: null,
      },
    },
    exportRequests: [
      {
        requestType: {
          type: String,
          enum: ['settings_data_export', 'job_history_export', 'interview_history_export'],
          default: 'settings_data_export',
        },
        status: {
          type: String,
          enum: ['pending', 'ready', 'failed'],
          default: 'pending',
        },
        requestedAt: { type: Date, default: Date.now },
        readyAt: { type: Date, default: null },
        expiresAt: { type: Date, default: null },
        downloadUrl: { type: String, default: null },
        error: { type: String, default: null },
      },
    ],
    consentRecords: [
      {
        consentType: {
          type: String,
          enum: ['terms', 'privacy', 'marketing', 'analytics', 'cookies', 'gdpr_data_processing'],
          required: true,
        },
        version: {
          type: String,
          default: '1.0.0',
        },
        granted: {
          type: Boolean,
          default: true,
        },
        grantedAt: {
          type: Date,
          default: Date.now,
        },
        revokedAt: {
          type: Date,
          default: null,
        },
        source: {
          type: String,
          default: 'app',
        },
        ipAddress: {
          type: String,
          default: null,
        },
        userAgent: {
          type: String,
          default: null,
        },
      },
    ],
    deletionLifecycle: {
      status: {
        type: String,
        enum: ['none', 'scheduled', 'cancelled', 'purged'],
        default: 'none',
        index: true,
      },
      requestedAt: {
        type: Date,
        default: null,
      },
      purgeAfter: {
        type: Date,
        default: null,
        index: true,
      },
      cancelledAt: {
        type: Date,
        default: null,
      },
      reason: {
        type: String,
        default: null,
      },
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    isBanned: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    trustScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 50,
      index: true,
    },
    trustStatus: {
      type: String,
      enum: ['healthy', 'watch', 'flagged', 'restricted'],
      default: 'healthy',
      index: true,
    },
    isFlagged: {
      type: Boolean,
      default: false,
      index: true,
    },
    trustVisibilityMultiplier: {
      type: Number,
      min: 0.4,
      max: 1,
      default: 1,
    },
    networkAuthorityScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 50,
      index: true,
    },
    hireSuccessScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    responseScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 50,
    },
    actionLimitsUntil: {
      type: Date,
      default: null,
    },
    // --- NEW FIELDS END ---

    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
      select: false, // CRITICAL: Never leak the hash in any query by default.
    },
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    tokenVersion: {
      type: Number,
      default: 0,
      min: 0,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    otpCodeHash: {
      type: String,
      default: null,
    },
    otpExpiry: {
      type: Date,
      default: null,
    },
    otpAttemptCount: {
      type: Number,
      default: 0,
    },
    otpRequestCount: {
      type: Number,
      default: 0,
    },
    otpRequestWindowStartedAt: {
      type: Date,
      default: null,
    },
    otpLastSentAt: {
      type: Date,
      default: null,
    },
    otpBlockedUntil: {
      type: Date,
      default: null,
    },
    pushTokens: [{
      type: String,
    }],
    deviceSessions: [
      {
        deviceId: {
          type: String,
          required: true,
          trim: true,
        },
        platform: {
          type: String,
          default: 'unknown',
          trim: true,
        },
        lastSeenAt: {
          type: Date,
          default: Date.now,
        },
        revokedAt: {
          type: Date,
          default: null,
        },
      },
    ],
    verificationToken: String,
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    loginAttempts: {
      type: Number,
      required: true,
      default: 0
    },
    lockUntil: {
      type: Number
    },
    // --- STRIPE & BILLING ---
    subscription: {
      plan: {
        type: String,
        enum: ['free', 'pro', 'enterprise'],
        default: 'free'
      },
      stripeCustomerId: String,
      stripeSubscriptionId: String,
      credits: {
        type: Number,
        default: 3 // Give 3 free credits on signup
      },
      billingPeriod: {
        type: String,
        enum: ['monthly', 'yearly', 'none'],
        default: 'none',
      },
      nextBillingDate: {
        type: Date,
        default: null,
      },
    },
    // --- MARKETING & REFERRAL ---
    referralCode: {
      type: String,
      unique: true,
      sparse: true // Allows nulls while enforcing uniqueness for non-nulls
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    acquisitionSource: {
      type: String,
      enum: ['camp', 'referral', 'organic', 'circle', 'unknown'],
      default: 'unknown',
      index: true,
    },
    acquisitionCity: {
      type: String,
      default: null,
      index: true,
    },
    acquisitionCampaign: {
      type: String,
      default: null,
    },

    // Enterprise Features
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization'
    },
    orgRole: {
      type: String,
      enum: ['admin', 'hiring_manager', 'recruiter', 'viewer'],
      default: 'viewer'
    }
  },
  {
    timestamps: true,
  }
);

// (The encryption logic below is unchanged from your original team code)
userSchema.pre('save', async function () {
  const legacyRoleValue = String(this.role || '').trim().toLowerCase();
  const legacyPrimaryRole = String(this.primaryRole || '').trim().toLowerCase();
  if (this.isNew && !this.isModified('activeRole')) {
    if (legacyRoleValue === 'recruiter' || legacyRoleValue === 'employer' || legacyPrimaryRole === 'employer') {
      this.activeRole = 'employer';
    }
  }

  const normalizedRoles = normalizeRolesList(this.roles);
  if (normalizedRoles.length > 0) {
    this.roles = normalizedRoles;
  } else {
    this.roles = ['worker', 'employer'];
  }

  this.activeRole = normalizeActiveRole(this.activeRole, this.roles[0] || 'worker');
  if (!this.roles.includes(this.activeRole)) {
    this.roles = Array.from(new Set([...this.roles, this.activeRole]));
  }

  this.primaryRole = this.activeRole;
  this.role = resolveLegacyRoleForActiveRole(this.activeRole);

  const defaultCapabilities = resolveDefaultCapabilities(this.activeRole);
  this.capabilities = {
    ...defaultCapabilities,
    ...(this.capabilities || {}),
    canPostJob: typeof this.capabilities?.canPostJob === 'boolean'
      ? this.capabilities.canPostJob
      : defaultCapabilities.canPostJob,
    canCreateCommunity: typeof this.capabilities?.canCreateCommunity === 'boolean'
      ? this.capabilities.canCreateCommunity
      : defaultCapabilities.canCreateCommunity,
    canCreateBounty: typeof this.capabilities?.canCreateBounty === 'boolean'
      ? this.capabilities.canCreateBounty
      : defaultCapabilities.canCreateBounty,
  };

  if (!this.primaryRole) {
    this.primaryRole = isRecruiter(this) ? 'employer' : 'worker';
  }

  const normalizedCountry = String(this.country || 'IN').trim().toUpperCase();
  this.country = normalizedCountry || 'IN';
  this.regionCode = normalizeRegionCode(
    this.regionCode || mapLocationToRegion({ location: this.city, countryCode: this.country }),
    this.country
  );
  this.primaryRegion = String(this.primaryRegion || process.env.APP_REGION || 'ap-south-1').trim();
  this.failoverRegion = String(this.failoverRegion || process.env.SECONDARY_REGION || '').trim();
  const localeBundle = COUNTRY_LOCALE_MAP[this.country] || COUNTRY_LOCALE_MAP.IN;
  if (!this.currencyCode) {
    this.currencyCode = localeBundle.currencyCode;
  }
  if (!this.languageCode) {
    this.languageCode = localeBundle.languageCode;
  }

  const sessionCriticalFields = ['password', 'role', 'roles', 'activeRole', 'isBanned', 'isDeleted', 'trustStatus'];
  const requiresTokenInvalidation = sessionCriticalFields.some(field => this.isModified(field)) && !this.isNew;

  if (requiresTokenInvalidation) {
    if (this.isModified('password')) {
      this.passwordChangedAt = new Date();
    }
    const currentTokenVersion = Number.parseInt(this.tokenVersion, 10);
    this.tokenVersion = Number.isFinite(currentTokenVersion) && currentTokenVersion >= 0
      ? currentTokenVersion + 1
      : 1;
  }

  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  // Guard against OAuth-only accounts (no password set) — return false without
  // throwing so timing difference does not reveal account existence.
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate and hash password token
userSchema.methods.getResetPasswordToken = function () {
  const crypto = require('crypto');
  // Generate token
  const resetToken = crypto.randomBytes(20).toString('hex');

  // Hash token and set to resetPasswordToken field
  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // Set expire (e.g., 10 minutes)
  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

// Infra hardening indexes for identity + admin filtering.
// `email` uniqueness is already enforced at schema field level; avoid duplicate index declaration.
userSchema.index({ phoneNumber: 1 }, { sparse: true });
userSchema.index({ roles: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ country: 1, regionCode: 1, activeRole: 1 });
userSchema.index({ 'deletionLifecycle.status': 1, 'deletionLifecycle.purgeAfter': 1 });
userSchema.index({ 'consentRecords.consentType': 1, 'consentRecords.grantedAt': -1 });

const User = mongoose.model('User', userSchema);

module.exports = User;
