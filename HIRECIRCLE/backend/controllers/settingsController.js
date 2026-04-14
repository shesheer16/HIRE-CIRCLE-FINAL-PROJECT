const fs = require('fs/promises');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const Job = require('../models/Job');
const Application = require('../models/Application');
const RevenueEvent = require('../models/RevenueEvent');
const Notification = require('../models/Notification');
const { EMPLOYER_PRIMARY_ROLE, hasEmployerPrimaryRole } = require('../utils/roleGuards');
const {
    applyRoleContractToUser,
    resolveUserRoleContract,
    normalizeActiveRole,
    defaultCapabilitiesForRole,
} = require('../utils/userRoleContract');
const { normalizeCountryCode, resolveLocaleBundle } = require('../services/geoExpansionService');
const { normalizeTimeZone, formatInTimeZone } = require('../utils/timezone');
const { getLegalConfigForCountry } = require('../services/legalConfigService');
const { delByPattern } = require('../services/cacheService');
const {
    DEFAULT_BASE_CURRENCY,
    buildMoneyView,
    resolveDisplayCurrency,
} = require('../services/currencyConversionService');
const { isRegionFeatureEnabled } = require('../services/regionFeatureFlagService');
const { deleteUserDataCascade } = require('../services/privacyService');
const { resolveExportRequestType, buildExportPayload } = require('../services/dataProtectionService');
const {
    evaluateProfileCompletion,
    syncUserProfileCompletionFlag,
} = require('../services/profileCompletionService');
const logger = require('../utils/logger');

const EXPORT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const EXPORT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;

const normalizeString = (value) => String(value || '').trim();
const toSafeBool = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return fallback;
};
const toNumberOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};
const hasValidAvatarSignature = async ({ filePath, mimeType }) => {
    const buffer = await fs.readFile(filePath);
    if (!buffer || buffer.length < 12) return false;

    const normalizedMimeType = String(mimeType || '').toLowerCase();
    if (normalizedMimeType === 'image/jpeg') {
        return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    if (normalizedMimeType === 'image/png') {
        return buffer[0] === 0x89
            && buffer[1] === 0x50
            && buffer[2] === 0x4e
            && buffer[3] === 0x47;
    }
    if (normalizedMimeType === 'image/webp') {
        return buffer.toString('ascii', 0, 4) === 'RIFF'
            && buffer.toString('ascii', 8, 12) === 'WEBP';
    }
    return false;
};
const uniqueStrings = (items = []) => Array.from(new Set(
    (Array.isArray(items) ? items : [])
        .map((item) => normalizeString(item))
        .filter(Boolean)
));

const normalizeMongoObjectId = (value) => {
    if (!value) return null;

    if (value instanceof mongoose.Types.ObjectId) {
        return value;
    }

    const directString = normalizeString(value);
    if (OBJECT_ID_REGEX.test(directString)) {
        return new mongoose.Types.ObjectId(directString);
    }

    if (typeof value === 'object') {
        const oid = normalizeString(value?.$oid);
        if (OBJECT_ID_REGEX.test(oid)) {
            return new mongoose.Types.ObjectId(oid);
        }

        const id = normalizeString(value?.id);
        if (OBJECT_ID_REGEX.test(id)) {
            return new mongoose.Types.ObjectId(id);
        }

        if (typeof value.toHexString === 'function') {
            const hex = normalizeString(value.toHexString());
            if (OBJECT_ID_REGEX.test(hex)) {
                return new mongoose.Types.ObjectId(hex);
            }
        }

        if (value.buffer && typeof value.buffer === 'object') {
            const raw = Array.isArray(value.buffer?.data)
                ? value.buffer.data
                : Object.values(value.buffer);
            if (raw.length === 12) {
                const hex = Buffer.from(raw).toString('hex');
                if (OBJECT_ID_REGEX.test(hex)) {
                    return new mongoose.Types.ObjectId(hex);
                }
            }
        }
    }

    return null;
};

const buildPlanLimits = (plan = 'free') => {
    if (plan === 'enterprise') return { activeJobs: 'unlimited', monthlyBoostCredits: 100 };
    if (plan === 'pro') return { activeJobs: 25, monthlyBoostCredits: 20 };
    return { activeJobs: 3, monthlyBoostCredits: 3 };
};

const getRoleLabel = (user) => {
    const roleContract = resolveUserRoleContract(user || {});
    return roleContract.activeRole === EMPLOYER_PRIMARY_ROLE ? EMPLOYER_PRIMARY_ROLE : 'worker';
};

const getProfileForUser = async (user) => {
    const isEmployer = getRoleLabel(user) === EMPLOYER_PRIMARY_ROLE;
    if (isEmployer) {
        const profile = await EmployerProfile.findOne({ user: user._id }).lean();
        return { profile, isEmployer };
    }
    const profile = await WorkerProfile.findOne({ user: user._id }).lean();
    return { profile, isEmployer };
};

const buildBillingOverview = async (user) => {
    const userObjectId = normalizeMongoObjectId(user?._id) || normalizeMongoObjectId(user?.id);
    const userIdHex = normalizeString(
        userObjectId && typeof userObjectId.toHexString === 'function'
            ? userObjectId.toHexString()
            : String(userObjectId || '')
    ).toLowerCase();
    if (!OBJECT_ID_REGEX.test(userIdHex)) {
        return {
            planName: String(user?.subscription?.plan || 'free'),
            billingPeriod: String(user?.subscription?.billingPeriod || 'none'),
            nextPaymentDate: user?.subscription?.nextBillingDate || null,
            status: String(user?.subscription?.plan || 'free') === 'free' ? 'inactive' : 'active',
            planUsageSummary: {
                activeJobs: 0,
                availableCredits: Number(user?.subscription?.credits || 0),
                invoicesLast30d: 0,
                spendLast30dInr: 0,
                spendLast30dBase: 0,
                spendLast30dDisplay: 0,
                baseCurrency: DEFAULT_BASE_CURRENCY,
                displayCurrency: resolveDisplayCurrency({
                    user,
                    fallback: String(user?.currencyCode || DEFAULT_BASE_CURRENCY).toUpperCase(),
                }),
                exchangeRateUsed: 1,
            },
            planLimits: buildPlanLimits(String(user?.subscription?.plan || 'free')),
        };
    }

    const plan = String(user?.subscription?.plan || 'free');
    const billingPeriod = String(user?.subscription?.billingPeriod || (plan === 'free' ? 'none' : 'monthly'));
    const nextPaymentDate = user?.subscription?.nextBillingDate || null;

    const [activeJobs, settledRevenue] = await Promise.all([
        Job.countDocuments({ employerId: userIdHex, isOpen: true }),
        RevenueEvent.aggregate([
            {
                $match: {
                    employerId: new mongoose.Types.ObjectId(userIdHex),
                    status: 'succeeded',
                    settledAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
                },
            },
            {
                $group: {
                    _id: null,
                    totalBase: { $sum: { $ifNull: ['$amountBase', '$amountInr'] } },
                    totalInr: { $sum: '$amountInr' },
                    invoicesCount: { $sum: 1 },
                },
            },
        ]),
    ]);

    const spendBase = Number(settledRevenue?.[0]?.totalBase || settledRevenue?.[0]?.totalInr || 0);
    const displayCurrency = resolveDisplayCurrency({
        user,
        fallback: String(user?.currencyCode || DEFAULT_BASE_CURRENCY).toUpperCase(),
    });
    const money = await buildMoneyView({
        baseAmount: spendBase,
        baseCurrency: DEFAULT_BASE_CURRENCY,
        displayCurrency,
    });

    const usage = {
        activeJobs,
        availableCredits: Number(user?.subscription?.credits || 0),
        invoicesLast30d: Number(settledRevenue?.[0]?.invoicesCount || 0),
        spendLast30dInr: Number(settledRevenue?.[0]?.totalInr || 0),
        spendLast30dBase: money.baseAmount,
        spendLast30dDisplay: money.displayAmount,
        baseCurrency: money.baseCurrency,
        displayCurrency: money.displayCurrency,
        exchangeRateUsed: money.exchangeRateUsed,
    };

    return {
        planName: plan,
        billingPeriod,
        nextPaymentDate,
        status: plan === 'free' ? 'inactive' : 'active',
        planUsageSummary: usage,
        planLimits: buildPlanLimits(plan),
    };
};

const buildInvoices = async (user) => {
    const userObjectId = normalizeMongoObjectId(user?._id) || normalizeMongoObjectId(user?.id);
    const userIdHex = normalizeString(
        userObjectId && typeof userObjectId.toHexString === 'function'
            ? userObjectId.toHexString()
            : String(userObjectId || '')
    ).toLowerCase();
    if (!OBJECT_ID_REGEX.test(userIdHex)) return [];

    const rows = await RevenueEvent.find({ employerId: userIdHex })
        .sort({ settledAt: -1 })
        .limit(50)
        .lean();

    const fallbackDisplayCurrency = resolveDisplayCurrency({
        user,
        fallback: String(user?.currencyCode || DEFAULT_BASE_CURRENCY).toUpperCase(),
    });

    return Promise.all(rows.map(async (row) => {
        const issuedAt = row.settledAt || row.createdAt;
        const money = await buildMoneyView({
            baseAmount: Number(row.amountBase || row.amountInr || 0),
            baseCurrency: String(row.baseCurrency || DEFAULT_BASE_CURRENCY).toUpperCase(),
            displayCurrency: String(row.displayCurrency || fallbackDisplayCurrency).toUpperCase(),
        });

        return ({
            invoiceId: row._id,
            eventType: row.eventType,
            amountInr: row.amountInr,
            amountBase: money.baseAmount,
            baseCurrency: money.baseCurrency,
            amountDisplay: money.displayAmount,
            displayCurrency: money.displayCurrency,
            exchangeRateUsed: Number(row.exchangeRateUsed || money.exchangeRateUsed || 1),
            currency: row.currency || String(money.displayCurrency || '').toLowerCase(),
            status: row.status,
            issuedAt,
            issuedAtLocal: formatInTimeZone(issuedAt, normalizeTimeZone(user?.timezone || 'UTC')),
            stripeSessionId: row.stripeSessionId || null,
            stripeSubscriptionId: row.stripeSubscriptionId || null,
        });
    }));
};

const buildSettingsResponse = async (userDoc, profileDoc = null) => {
    const user = userDoc?.toObject ? userDoc.toObject() : userDoc;
    const roleContract = resolveUserRoleContract(user);
    const profile = profileDoc || (await getProfileForUser(user)).profile;
    const isEmployer = roleContract.activeRole === EMPLOYER_PRIMARY_ROLE;

    const roleProfiles = Array.isArray(profile?.roleProfiles) ? profile.roleProfiles : [];
    const primaryRoleProfile = roleProfiles[0] || {};
    const accountCity = normalizeString(user?.city || profile?.city || profile?.location || '');
    const accountCountry = normalizeCountryCode(user?.country || profile?.country || 'IN');
    const accountTimezone = normalizeTimeZone(user?.timezone || 'UTC');
    const legalConfig = await getLegalConfigForCountry(accountCountry);
    const [
        videoCallEnabled,
        escrowEnabled,
        bountiesEnabled,
    ] = await Promise.all([
        isRegionFeatureEnabled({ key: 'FEATURE_VIDEO_CALL', user, country: accountCountry, fallback: true }),
        isRegionFeatureEnabled({ key: 'FEATURE_ESCROW', user, country: accountCountry, fallback: true }),
        isRegionFeatureEnabled({ key: 'FEATURE_BOUNTIES', user, country: accountCountry, fallback: true }),
    ]);

    const allSkillTags = uniqueStrings(
        roleProfiles.flatMap((roleProfile) => Array.isArray(roleProfile?.skills) ? roleProfile.skills : [])
    );

    const canViewAdvanced = Boolean(user?.isAdmin || user?.isExperimentUser || user?.featureToggles?.FEATURE_SETTINGS_ADVANCED);

    return {
        roleContract,
        accountInfo: {
            name: user?.name || '',
            email: user?.email || '',
            emailReadOnly: !Boolean(user?.linkedAccounts?.emailPassword),
            phoneNumber: user?.phoneNumber || '',
            city: accountCity,
            state: normalizeString(user?.state || ''),
            country: accountCountry,
            timezone: accountTimezone,
            languagePreference: String(user?.languagePreference || user?.languageCode || 'en'),
            currencyCode: String(user?.currencyCode || resolveLocaleBundle(accountCountry).currencyCode || 'INR'),
            languageCode: String(user?.languageCode || resolveLocaleBundle(accountCountry).languageCode || 'en-IN'),
            role: roleContract.activeRole,
            experienceLevel: Number(profile?.totalExperience || 0),
            skillTags: allSkillTags,
            profilePhoto: profile?.avatar || profile?.logoUrl || null,
        },
        notificationPreferences: user?.notificationPreferences || {},
        privacyPreferences: user?.privacyPreferences || {},
        matchPreferences: profile?.settings?.matchPreferences || {
            maxCommuteDistanceKm: 25,
            salaryExpectationMin: null,
            salaryExpectationMax: null,
            preferredShiftTimes: [],
            roleClusters: [],
            minimumMatchTier: 'GOOD',
        },
        billingOverview: await buildBillingOverview(user),
        security: {
            twoFactorEnabled: Boolean(user?.securitySettings?.twoFactorEnabled),
            twoFactorMethod: user?.securitySettings?.twoFactorMethod || 'email',
            linkedAccounts: user?.linkedAccounts || {},
        },
        globalPreferences: user?.globalPreferences || {},
        taxProfile: user?.taxProfile || {},
        legalConfig,
        regionalFeatureFlags: {
            FEATURE_VIDEO_CALL: videoCallEnabled,
            FEATURE_ESCROW: escrowEnabled,
            FEATURE_BOUNTIES: bountiesEnabled,
        },
        dataManagement: {
            latestExportRequest: Array.isArray(user?.exportRequests) && user.exportRequests.length > 0
                ? [...user.exportRequests].sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt))[0]
                : null,
        },
        featureToggles: canViewAdvanced ? (user?.featureToggles || {}) : {},
        canViewAdvanced,
    };
};

const assertSensitiveUpdateAllowed = async ({ userWithPassword, incomingEmail, incomingPhoneNumber, currentPassword }) => {
    const emailChanged = incomingEmail && normalizeString(incomingEmail).toLowerCase() !== normalizeString(userWithPassword.email).toLowerCase();
    const phoneChanged = incomingPhoneNumber !== undefined && normalizeString(incomingPhoneNumber) !== normalizeString(userWithPassword.phoneNumber);
    if (!emailChanged && !phoneChanged) return;

    if (!currentPassword) {
        const error = new Error('currentPassword is required to change email or phone number');
        error.statusCode = 400;
        throw error;
    }

    const passwordMatches = await bcrypt.compare(String(currentPassword), String(userWithPassword.password || ''));
    if (!passwordMatches) {
        const error = new Error('Current password is incorrect');
        error.statusCode = 401;
        throw error;
    }
};

const sanitizeNotificationPreferences = (payload = {}) => ({
    pushEnabled: toSafeBool(payload.pushEnabled, true),
    smsEnabled: toSafeBool(payload.smsEnabled, false),
    emailEnabled: toSafeBool(payload.emailEnabled, true),
    notifyNewJobRecommendations: toSafeBool(payload.notifyNewJobRecommendations, true),
    notifyInterviewReady: toSafeBool(payload.notifyInterviewReady, true),
    notifyApplicationStatus: toSafeBool(payload.notifyApplicationStatus, true),
    notifyPromotions: toSafeBool(payload.notifyPromotions, true),
    notifyMatch: toSafeBool(payload.notifyMatch, true),
    notifyApplication: toSafeBool(payload.notifyApplication, true),
    notifyHire: toSafeBool(payload.notifyHire, true),
});

const sanitizePrivacyPreferences = (payload = {}) => {
    const radius = toNumberOrNull(payload.locationVisibilityRadiusKm);
    return {
        profileVisibleToEmployers: toSafeBool(payload.profileVisibleToEmployers, true),
        showSalaryExpectation: toSafeBool(payload.showSalaryExpectation, true),
        showInterviewBadge: toSafeBool(payload.showInterviewBadge, true),
        showLastActive: toSafeBool(payload.showLastActive, true),
        allowLocationSharing: toSafeBool(payload.allowLocationSharing, true),
        locationVisibilityRadiusKm: radius === null ? 25 : Math.max(1, Math.min(200, radius)),
    };
};

const sanitizeFeatureToggles = (payload = {}) => ({
    FEATURE_MATCH_UI_V1: toSafeBool(payload.FEATURE_MATCH_UI_V1, true),
    FEATURE_PROBABILISTIC_MATCH: toSafeBool(payload.FEATURE_PROBABILISTIC_MATCH, true),
    FEATURE_COLD_START_BOOST_SUGGESTIONS: toSafeBool(payload.FEATURE_COLD_START_BOOST_SUGGESTIONS, false),
    FEATURE_MATCH_ALERTS: toSafeBool(payload.FEATURE_MATCH_ALERTS, true),
    FEATURE_SETTINGS_ADVANCED: toSafeBool(payload.FEATURE_SETTINGS_ADVANCED, false),
    FEATURE_DETAILED_JOB_ANALYTICS: toSafeBool(payload.FEATURE_DETAILED_JOB_ANALYTICS, false),
    FEATURE_SMART_PUSH_TIMING: toSafeBool(payload.FEATURE_SMART_PUSH_TIMING, false),
});

const sanitizeGlobalPreferences = (payload = {}) => ({
    crossBorderMatchEnabled: toSafeBool(payload.crossBorderMatchEnabled, false),
    displayCurrency: normalizeString(payload.displayCurrency || '').toUpperCase() || null,
});

const sanitizeTaxProfile = (payload = {}) => ({
    taxId: normalizeString(payload.taxId || '') || null,
    businessType: normalizeString(payload.businessType || '') || null,
    invoicePreference: normalizeString(payload.invoicePreference || '') || null,
});

const sanitizeMatchPreferences = (payload = {}) => {
    const maxCommuteDistanceKm = toNumberOrNull(payload.maxCommuteDistanceKm);
    const salaryExpectationMin = toNumberOrNull(payload.salaryExpectationMin);
    const salaryExpectationMax = toNumberOrNull(payload.salaryExpectationMax);
    const minimumMatchTier = String(payload.minimumMatchTier || 'GOOD').toUpperCase();

    return {
        maxCommuteDistanceKm: Math.max(1, Math.min(300, maxCommuteDistanceKm || 25)),
        salaryExpectationMin,
        salaryExpectationMax: salaryExpectationMax !== null && salaryExpectationMin !== null && salaryExpectationMax < salaryExpectationMin
            ? salaryExpectationMin
            : salaryExpectationMax,
        preferredShiftTimes: uniqueStrings(payload.preferredShiftTimes),
        roleClusters: uniqueStrings(payload.roleClusters),
        minimumMatchTier: ['STRONG', 'GOOD', 'POSSIBLE'].includes(minimumMatchTier) ? minimumMatchTier : 'GOOD',
    };
};

const getSettings = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password');
        if (!user || user.isDeleted) {
            return res.status(404).json({ message: 'User not found' });
        }

        const { profile } = await getProfileForUser(user);
        const settings = await buildSettingsResponse(user, profile);
        return res.json(settings);
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load settings' });
    }
};

const getLegalConfig = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('country');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const legalConfig = await getLegalConfigForCountry(user.country || 'IN');
        return res.json({ legalConfig });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to load legal configuration' });
    }
};

const updateSettings = async (req, res) => {
    try {
        const payload = req.body || {};
        const userWithPassword = await User.findById(req.user._id);
        if (!userWithPassword || userWithPassword.isDeleted) {
            return res.status(404).json({ message: 'User not found' });
        }

        const { profile, isEmployer } = await getProfileForUser(userWithPassword);
        const accountInfo = payload.accountInfo || {};
        const changedFields = [];
        let activeRoleChanged = false;

        await assertSensitiveUpdateAllowed({
            userWithPassword,
            incomingEmail: accountInfo.email,
            incomingPhoneNumber: accountInfo.phoneNumber,
            currentPassword: payload.currentPassword,
        });

        if (accountInfo.name !== undefined) {
            const name = normalizeString(accountInfo.name);
            if (name.length < 2) return res.status(400).json({ message: 'Name must be at least 2 characters' });
            userWithPassword.name = name;
            changedFields.push('accountInfo.name');
        }

        if (accountInfo.email !== undefined) {
            const email = normalizeString(accountInfo.email).toLowerCase();
            if (!EMAIL_REGEX.test(email)) return res.status(400).json({ message: 'Invalid email' });
            if (!userWithPassword.linkedAccounts?.emailPassword) {
                return res.status(400).json({ message: 'Email is managed by linked social account' });
            }
            userWithPassword.email = email;
            changedFields.push('accountInfo.email');
        }

        if (accountInfo.phoneNumber !== undefined) {
            const phoneNumber = normalizeString(accountInfo.phoneNumber);
            if (phoneNumber && !PHONE_REGEX.test(phoneNumber)) {
                return res.status(400).json({ message: 'Invalid phone number format' });
            }
            userWithPassword.phoneNumber = phoneNumber || null;
            changedFields.push('accountInfo.phoneNumber');
        }

        if (accountInfo.city !== undefined) {
            const city = normalizeString(accountInfo.city);
            userWithPassword.city = city || null;
            changedFields.push('accountInfo.city');

            if (isEmployer) {
                await EmployerProfile.findOneAndUpdate(
                    { user: userWithPassword._id },
                    { $set: { location: city || (profile?.location || 'Unknown') } },
                    { upsert: true }
                );
            } else {
                await WorkerProfile.findOneAndUpdate(
                    { user: userWithPassword._id },
                    { $set: { city: city || (profile?.city || 'Unknown') } },
                    { upsert: true }
                );
            }
        }

        if (accountInfo.state !== undefined) {
            const state = normalizeString(accountInfo.state);
            userWithPassword.state = state || null;
            changedFields.push('accountInfo.state');
        }

        if (accountInfo.timezone !== undefined) {
            userWithPassword.timezone = normalizeTimeZone(accountInfo.timezone || 'UTC');
            changedFields.push('accountInfo.timezone');
        }

        if (accountInfo.country !== undefined) {
            const countryCode = normalizeCountryCode(accountInfo.country);
            const localeBundle = resolveLocaleBundle(countryCode);
            userWithPassword.country = countryCode;
            userWithPassword.currencyCode = localeBundle.currencyCode;
            userWithPassword.languageCode = localeBundle.languageCode;
            userWithPassword.globalPreferences = {
                ...userWithPassword.globalPreferences,
                displayCurrency: localeBundle.currencyCode,
            };
            changedFields.push('accountInfo.country');
            changedFields.push('accountInfo.currencyCode');
            changedFields.push('accountInfo.languageCode');

            if (isEmployer) {
                await EmployerProfile.findOneAndUpdate(
                    { user: userWithPassword._id },
                    { $set: { country: countryCode } },
                    { upsert: true }
                );
            } else {
                await WorkerProfile.findOneAndUpdate(
                    { user: userWithPassword._id },
                    { $set: { country: countryCode } },
                    { upsert: true }
                );
            }
        }

        if (accountInfo.languagePreference !== undefined) {
            userWithPassword.languagePreference = normalizeString(accountInfo.languagePreference) || 'en';
            changedFields.push('accountInfo.languagePreference');
        }

        if (accountInfo.languageCode !== undefined) {
            userWithPassword.languageCode = normalizeString(accountInfo.languageCode) || userWithPassword.languageCode;
            changedFields.push('accountInfo.languageCode');
        }

        if (accountInfo.currencyCode !== undefined) {
            userWithPassword.currencyCode = normalizeString(accountInfo.currencyCode).toUpperCase() || userWithPassword.currencyCode;
            userWithPassword.globalPreferences = {
                ...userWithPassword.globalPreferences,
                displayCurrency: userWithPassword.currencyCode,
            };
            changedFields.push('accountInfo.currencyCode');
        }

        if (accountInfo.role !== undefined) {
            const normalizedRole = normalizeActiveRole(normalizeString(accountInfo.role), 'worker');
            activeRoleChanged = normalizedRole !== String(userWithPassword.activeRole || '');
            applyRoleContractToUser(userWithPassword, {
                activeRole: normalizedRole,
                capabilities: defaultCapabilitiesForRole(normalizedRole),
            });
            if (normalizedRole === 'worker') {
                const safeNameParts = String(userWithPassword.name || 'User').trim().split(' ').filter(Boolean);
                const firstName = String(safeNameParts[0] || 'User').trim();
                const lastName = String(safeNameParts.slice(1).join(' ') || '').trim();
                const city = normalizeString(userWithPassword.city || profile?.city || profile?.location || 'Hyderabad');
                await WorkerProfile.findOneAndUpdate(
                    { user: userWithPassword._id },
                    {
                        $setOnInsert: {
                            user: userWithPassword._id,
                            firstName,
                            lastName,
                            city,
                            country: normalizeCountryCode(userWithPassword.country || 'IN'),
                            isAvailable: true,
                            preferredShift: 'Flexible',
                        },
                    },
                    { upsert: true, setDefaultsOnInsert: true }
                );
            }
            changedFields.push('accountInfo.role');
        }

        if (!isEmployer) {
            const workerUpdates = {};
            if (accountInfo.experienceLevel !== undefined) {
                workerUpdates.totalExperience = Math.max(0, Number(accountInfo.experienceLevel) || 0);
                changedFields.push('accountInfo.experienceLevel');
            }
            if (accountInfo.skillTags !== undefined) {
                const skillTags = uniqueStrings(accountInfo.skillTags);
                const existingWorkerProfile = profile || await WorkerProfile.findOne({ user: userWithPassword._id }).lean();
                const roleProfiles = Array.isArray(existingWorkerProfile?.roleProfiles) ? existingWorkerProfile.roleProfiles : [];
                if (roleProfiles.length > 0) {
                    roleProfiles[0] = {
                        ...roleProfiles[0],
                        skills: skillTags,
                    };
                } else {
                    roleProfiles.push({
                        roleName: 'General Worker',
                        experienceInRole: workerUpdates.totalExperience || 0,
                        expectedSalary: null,
                        skills: skillTags,
                    });
                }
                workerUpdates.roleProfiles = roleProfiles;
                changedFields.push('accountInfo.skillTags');
            }
            if (Object.keys(workerUpdates).length) {
                await WorkerProfile.findOneAndUpdate(
                    { user: userWithPassword._id },
                    { $set: workerUpdates },
                    { upsert: true }
                );
            }
        }

        if (payload.notificationPreferences) {
            userWithPassword.notificationPreferences = {
                ...userWithPassword.notificationPreferences,
                ...sanitizeNotificationPreferences(payload.notificationPreferences),
            };
            changedFields.push('notificationPreferences');
        }

        if (payload.privacyPreferences) {
            userWithPassword.privacyPreferences = {
                ...userWithPassword.privacyPreferences,
                ...sanitizePrivacyPreferences(payload.privacyPreferences),
            };
            changedFields.push('privacyPreferences');
        }

        if (payload.featureToggles) {
            const canEditAdvanced = Boolean(userWithPassword.isAdmin || userWithPassword.isExperimentUser || userWithPassword.featureToggles?.FEATURE_SETTINGS_ADVANCED);
            if (!canEditAdvanced) {
                return res.status(403).json({ message: 'Advanced feature toggles are not enabled for this account' });
            }
            userWithPassword.featureToggles = {
                ...userWithPassword.featureToggles,
                ...sanitizeFeatureToggles(payload.featureToggles),
            };
            changedFields.push('featureToggles');
        }

        if (payload.globalPreferences) {
            userWithPassword.globalPreferences = {
                ...userWithPassword.globalPreferences,
                ...sanitizeGlobalPreferences(payload.globalPreferences),
            };
            changedFields.push('globalPreferences');
        }

        if (payload.taxProfile) {
            userWithPassword.taxProfile = {
                ...userWithPassword.taxProfile,
                ...sanitizeTaxProfile(payload.taxProfile),
            };
            changedFields.push('taxProfile');
        }

        if (payload.matchPreferences && !isEmployer) {
            const matchPreferences = sanitizeMatchPreferences(payload.matchPreferences);
            await WorkerProfile.findOneAndUpdate(
                { user: userWithPassword._id },
                { $set: { 'settings.matchPreferences': matchPreferences } },
                { upsert: true }
            );
            changedFields.push('matchPreferences');
        }

        await userWithPassword.save();

        if (activeRoleChanged) {
            const io = req.app?.get?.('io');
            if (io) {
                io.to(`user_${String(userWithPassword._id)}`).emit('session_role_updated', {
                    userId: String(userWithPassword._id),
                    activeRole: String(userWithPassword.activeRole || 'worker'),
                    roles: Array.isArray(userWithPassword.roles) ? userWithPassword.roles : ['worker'],
                    at: new Date().toISOString(),
                });
            }
        }

        await Promise.all([
            delByPattern('cache:public_profile:*'),
            delByPattern('cache:profile:public:*'),
            hasEmployerPrimaryRole(userWithPassword) ? delByPattern('cache:analytics:employer-summary:*') : Promise.resolve(0),
        ]).catch(() => { });

        const latestUser = await User.findById(userWithPassword._id).select('-password');
        const { profile: latestProfile } = await getProfileForUser(latestUser);
        const latestRoleLabel = getRoleLabel(latestUser);
        const completion = evaluateProfileCompletion({
            user: latestUser || {},
            workerProfile: latestRoleLabel === EMPLOYER_PRIMARY_ROLE ? null : latestProfile,
            employerProfile: latestRoleLabel === EMPLOYER_PRIMARY_ROLE ? latestProfile : null,
            roleOverride: latestRoleLabel === EMPLOYER_PRIMARY_ROLE ? 'employer' : 'worker',
        });
        await syncUserProfileCompletionFlag({
            userDoc: latestUser,
            completion,
        });
        const settings = await buildSettingsResponse(latestUser, latestProfile);

        return res.json({
            success: true,
            changedFields,
            settings,
            profileCompletion: completion,
        });
    } catch (error) {
        const statusCode = Number(error?.statusCode || 500);
        logger.error({
            event: 'update_settings_error',
            message: error?.message || 'unknown_error',
            stack: error?.stack || null,
        });
        return res.status(statusCode).json({ message: error.message || 'Failed to update settings' });
    }
};

const syncCloudAvatarUrl = async (req, res) => {
    try {
        const { avatarUrl, role } = req.body || {};
        if (!avatarUrl || typeof avatarUrl !== 'string' || !avatarUrl.startsWith('http')) {
            return res.status(400).json({ message: 'Valid avatarUrl is required' });
        }

        const explicitRole = role ? String(role).trim().toLowerCase() : null;
        const isEmployer = explicitRole === 'employer' || (explicitRole !== 'worker' && hasEmployerPrimaryRole(req.user));
        
        if (isEmployer) {
            await EmployerProfile.findOneAndUpdate(
                { user: req.user._id },
                { $set: { logoUrl: avatarUrl } },
                { upsert: true }
            );
        } else {
            await WorkerProfile.findOneAndUpdate(
                { user: req.user._id },
                { $set: { avatar: avatarUrl } },
                { upsert: true }
            );
        }

        const latestUser = await User.findById(req.user._id).select('-password');
        const latestProfile = isEmployer
            ? await EmployerProfile.findOne({ user: req.user._id }).lean()
            : await WorkerProfile.findOne({ user: req.user._id }).lean();
            
        const completion = evaluateProfileCompletion({
            user: latestUser || {},
            workerProfile: isEmployer ? null : latestProfile,
            employerProfile: isEmployer ? latestProfile : null,
            roleOverride: isEmployer ? 'employer' : 'worker',
        });
        
        await syncUserProfileCompletionFlag({
            userDoc: latestUser,
            completion,
        });

        return res.json({
            success: true,
            avatarUrl,
            profileCompletion: completion,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to sync avatar URL' });
    }
};

const updateNotificationPreferences = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user || user.isDeleted) return res.status(404).json({ message: 'User not found' });

        user.notificationPreferences = {
            ...user.notificationPreferences,
            ...sanitizeNotificationPreferences(req.body || {}),
        };
        await user.save();

        return res.json({
            success: true,
            notificationPreferences: user.notificationPreferences,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to update notification preferences' });
    }
};

const updatePrivacyPreferences = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user || user.isDeleted) return res.status(404).json({ message: 'User not found' });

        user.privacyPreferences = {
            ...user.privacyPreferences,
            ...sanitizePrivacyPreferences(req.body || {}),
        };
        await user.save();

        return res.json({
            success: true,
            privacyPreferences: user.privacyPreferences,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to update privacy preferences' });
    }
};

const updateSecuritySettings = async (req, res) => {
    try {
        const {
            currentPassword = '',
            newPassword = '',
            twoFactorEnabled,
            twoFactorMethod,
            linkedAccounts,
        } = req.body || {};

        const user = await User.findById(req.user._id);
        if (!user || user.isDeleted) return res.status(404).json({ message: 'User not found' });

        if (newPassword) {
            if (!user.linkedAccounts?.emailPassword) {
                return res.status(400).json({ message: 'Password change is unavailable for social-auth only accounts' });
            }
            if (!currentPassword) {
                return res.status(400).json({ message: 'currentPassword is required' });
            }

            const passwordMatches = await bcrypt.compare(String(currentPassword), String(user.password || ''));
            if (!passwordMatches) {
                return res.status(401).json({ message: 'Current password is incorrect' });
            }

            if (String(newPassword).length < 8) {
                return res.status(400).json({ message: 'New password must be at least 8 characters' });
            }

            user.password = String(newPassword);
        }

        if (twoFactorEnabled !== undefined) {
            user.securitySettings = {
                ...user.securitySettings,
                twoFactorEnabled: toSafeBool(twoFactorEnabled, false),
                twoFactorMethod: String(twoFactorMethod || user.securitySettings?.twoFactorMethod || 'email').toLowerCase() === 'sms'
                    ? 'sms'
                    : 'email',
            };
        }

        if (linkedAccounts && typeof linkedAccounts === 'object') {
            user.linkedAccounts = {
                ...user.linkedAccounts,
                google: toSafeBool(linkedAccounts.google, user.linkedAccounts?.google),
                apple: toSafeBool(linkedAccounts.apple, user.linkedAccounts?.apple),
                emailPassword: toSafeBool(linkedAccounts.emailPassword, user.linkedAccounts?.emailPassword),
            };
        }

        await user.save();

        return res.json({
            success: true,
            security: {
                twoFactorEnabled: Boolean(user.securitySettings?.twoFactorEnabled),
                twoFactorMethod: user.securitySettings?.twoFactorMethod || 'email',
                linkedAccounts: user.linkedAccounts || {},
            },
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to update security settings' });
    }
};

const requestDataDownload = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user || user.isDeleted) return res.status(404).json({ message: 'User not found' });
        const requestType = resolveExportRequestType(req.body?.requestType);

        if (process.env.NODE_ENV !== 'production') {
            const sample = await Application.findOne().lean();
            if (sample && !Object.prototype.hasOwnProperty.call(sample, 'worker')) {
                throw new Error('[EXPORT CONTRACT BROKEN] Application.worker field missing');
            }
        }

        const now = Date.now();
        const latestExport = Array.isArray(user.exportRequests) && user.exportRequests.length
            ? [...user.exportRequests].sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt))[0]
            : null;

        if (latestExport?.requestedAt && (now - new Date(latestExport.requestedAt).getTime()) < EXPORT_COOLDOWN_MS) {
            const retryAfterMs = EXPORT_COOLDOWN_MS - (now - new Date(latestExport.requestedAt).getTime());
            return res.status(429).json({
                message: 'Data export can only be requested once every 7 days',
                retryAfterMs,
            });
        }

        user.exportRequests.push({
            requestType,
            status: 'pending',
            requestedAt: new Date(),
        });
        const exportRequest = user.exportRequests[user.exportRequests.length - 1];
        await user.save();

        const workerProfile = await WorkerProfile.findOne({ user: user._id }).lean();
        if (!workerProfile) {
            console.warn(`[EXPORT] WorkerProfile missing for user ${user._id}`);
        }

        const [profileInfo, jobs, applications] = await Promise.all([
            getProfileForUser(user),
            Job.find({ employerId: user._id }).lean(),
            workerProfile
                ? Application.find({ worker: workerProfile._id })
                    .populate('job')
                    .lean()
                : Promise.resolve([]),
        ]);

        const settings = await buildSettingsResponse(user, profileInfo.profile);
        const exportPayload = buildExportPayload({
            user,
            settings,
            jobs,
            applications,
            requestType,
        });

        const exportsDir = path.join(__dirname, '..', 'exports');
        await fs.mkdir(exportsDir, { recursive: true });

        const fileName = `settings-export-${user._id}-${Date.now()}.json`;
        const filePath = path.join(exportsDir, fileName);
        await fs.writeFile(filePath, JSON.stringify(exportPayload, null, 2), 'utf8');

        const persistedUser = await User.findById(user._id);
        const requestRow = persistedUser.exportRequests.id(exportRequest._id);
        if (requestRow) {
            requestRow.status = 'ready';
            requestRow.readyAt = new Date();
            requestRow.expiresAt = new Date(Date.now() + EXPORT_EXPIRY_MS);
            requestRow.downloadUrl = `/exports/${fileName}`;
            requestRow.error = null;
            await persistedUser.save();
        }

        await Notification.create({
            user: user._id,
            type: 'status_update',
            title: 'Your data export is ready',
            message: 'You can now download your account export from Settings.',
            relatedData: {
                exportRequestId: exportRequest._id,
                downloadUrl: `/exports/${fileName}`,
            },
        });

        return res.status(202).json({
            success: true,
            requestId: exportRequest._id,
            status: 'ready',
            downloadUrl: `/exports/${fileName}`,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to create data export request' });
    }
};

const deleteAccount = async (req, res) => {
    try {
        const { password } = req.body || {};
        if (!password) {
            return res.status(400).json({ message: 'password is required' });
        }

        const user = await User.findById(req.user._id);
        if (!user || user.isDeleted) {
            return res.status(404).json({ message: 'User not found' });
        }

        const isPasswordValid = await bcrypt.compare(String(password), String(user.password || ''));
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Password confirmation failed' });
        }

        const deletion = await deleteUserDataCascade({ userId: user._id });
        if (!deletion?.deleted) {
            return res.status(500).json({ message: 'Failed to delete account records' });
        }

        return res.json({
            success: true,
            message: 'Account and associated data deleted permanently.',
            deletion,
        });
    } catch (error) {
        logger.warn({
            event: 'delete_account_failed',
            message: error?.message || 'unknown error',
            userId: String(req.user?._id || ''),
        });
        const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
        return res.status(500).json({
            message: 'Failed to delete account',
            reason: isProduction ? undefined : (error?.message || 'unknown error'),
        });
    }
};

const getBillingOverview = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password');
        if (!user || user.isDeleted) return res.status(404).json({ message: 'User not found' });

        const billingOverview = await buildBillingOverview(user);
        return res.json({ success: true, billingOverview });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load billing overview' });
    }
};

const getInvoices = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password');
        if (!user || user.isDeleted) return res.status(404).json({ message: 'User not found' });

        const invoices = await buildInvoices(user);
        return res.json({ success: true, invoices });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load invoices' });
    }
};

module.exports = {
    getSettings,
    getLegalConfig,
    updateSettings,
    syncCloudAvatarUrl,
    updateNotificationPreferences,
    updatePrivacyPreferences,
    updateSecuritySettings,
    requestDataDownload,
    deleteAccount,
    getBillingOverview,
    getInvoices,
};
