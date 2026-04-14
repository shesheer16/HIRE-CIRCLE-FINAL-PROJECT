const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid object id');

const optionalTrimmedString = (max = 255) => z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
        if (value === null || typeof value === 'undefined') return undefined;
        const normalized = String(value).trim();
        return normalized.length ? normalized : undefined;
    })
    .refine((value) => typeof value === 'undefined' || value.length <= max, {
        message: `Must be at most ${max} characters`,
    });

const signupSchema = z.object({
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().email().transform((value) => value.toLowerCase()),
    phoneNumber: optionalTrimmedString(20),
    password: z.string()
        .min(8)
        .max(128)
        .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
        .regex(/[a-z]/, 'Password must include at least one lowercase letter')
        .regex(/[0-9]/, 'Password must include at least one number')
        .regex(/[^A-Za-z0-9]/, 'Password must include at least one symbol'),
    country: optionalTrimmedString(4),
    state: optionalTrimmedString(64),
    timezone: optionalTrimmedString(64),
    languagePreference: optionalTrimmedString(16),
    betaCode: optionalTrimmedString(32),
    referredByCode: optionalTrimmedString(32),
    acquisitionSource: z.enum(['camp', 'referral', 'organic', 'circle', 'unknown']).optional(),
    acquisitionCity: optionalTrimmedString(64),
    acquisitionCampaign: optionalTrimmedString(128),
    selectedRole: optionalTrimmedString(32),
}).strict();

const loginSchema = z.object({
    email: z.string().trim().email().transform((value) => value.toLowerCase()),
    password: z.string().min(1).max(128),
    selectedRole: z.string().trim().toLowerCase().optional(),
}).strict();

const refreshTokenSchema = z.object({
    refreshToken: optionalTrimmedString(2048),
}).strict();

const logoutSchema = z.object({
    refreshToken: optionalTrimmedString(2048),
    deviceId: optionalTrimmedString(128),
}).strict();

const forgotPasswordSchema = z.object({
    email: z.string().trim().email().transform((value) => value.toLowerCase()),
}).strict();

const resendVerificationSchema = z.object({
    email: z.string().trim().email().transform((value) => value.toLowerCase()),
}).strict();

const resetPasswordSchema = z.object({
    password: z.string()
        .min(10)
        .max(128)
        .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
        .regex(/[a-z]/, 'Password must include at least one lowercase letter')
        .regex(/[0-9]/, 'Password must include at least one number')
        .regex(/[^A-Za-z0-9]/, 'Password must include at least one symbol'),
}).strict();

const otpSendSchema = z.object({
    email: optionalTrimmedString(200),
    phone: optionalTrimmedString(20),
    phoneNumber: optionalTrimmedString(20),
}).strict().superRefine((payload, ctx) => {
    const email = String(payload.email || '').trim();
    const phone = String(payload.phone || payload.phoneNumber || '').trim();
    if (!email && !phone) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'email or phone is required',
            path: ['email'],
        });
    }

    if (email && !z.string().email().safeParse(email).success) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Invalid email format',
            path: ['email'],
        });
    }
});

const otpVerifySchema = z.object({
    email: optionalTrimmedString(200),
    phone: optionalTrimmedString(20),
    phoneNumber: optionalTrimmedString(20),
    otp: z.string().trim().regex(/^\d{4,8}$/, 'Invalid OTP format'),
    intent: optionalTrimmedString(32),
}).strict().superRefine((payload, ctx) => {
    const email = String(payload.email || '').trim();
    const phone = String(payload.phone || payload.phoneNumber || '').trim();
    if (!email && !phone) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'email or phone is required',
            path: ['email'],
        });
    }
});

const jobPostSchema = z.object({
    title: z.string().trim().min(2).max(120),
    companyName: z.string().trim().min(2).max(120),
    salaryRange: z.string().trim().min(1).max(120),
    location: z.string().trim().min(1).max(120),
    district: optionalTrimmedString(120),
    mandal: optionalTrimmedString(120),
    locationLabel: optionalTrimmedString(160),
    countryCode: optionalTrimmedString(4),
    region: optionalTrimmedString(32),
    regionCode: optionalTrimmedString(32),
    currencyCode: optionalTrimmedString(8),
    languageCode: optionalTrimmedString(16),
    remoteAllowed: z.boolean().optional(),
    requirements: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    screeningQuestions: z.array(z.string().trim().min(1).max(250)).max(20).optional(),
    minSalary: z.number().int().nonnegative().optional(),
    maxSalary: z.number().int().nonnegative().optional(),
    openings: z.number().int().nonnegative().optional(),
    shift: z.preprocess((value) => {
        if (value === null || typeof value === 'undefined') return undefined;
        const normalized = String(value).trim().toLowerCase();
        if (!normalized) return undefined;
        if (normalized === 'day') return 'Day';
        if (normalized === 'night') return 'Night';
        if (normalized === 'flexible') return 'Flexible';
        return value;
    }, z.enum(['Day', 'Night', 'Flexible'])).optional(),
    mandatoryLicenses: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    isPulse: z.boolean().optional(),
    expiresAt: z.union([z.string(), z.number(), z.date(), z.null(), z.undefined()])
        .transform((value) => {
            if (value === null || typeof value === 'undefined') return undefined;
            if (value instanceof Date) return value.toISOString();
            const normalized = String(value).trim();
            return normalized.length ? normalized : undefined;
        })
        .refine((value) => typeof value === 'undefined' || value.length <= 64, {
            message: 'Must be at most 64 characters',
        }),
    contactPerson: optionalTrimmedString(120),
    processingId: optionalTrimmedString(120),
    description: optionalTrimmedString(5000),
}).strict();

const communityCreateSchema = z.object({
    name: z.string().trim().min(2).max(80),
    description: optionalTrimmedString(1000),
    category: optionalTrimmedString(80),
    privacy: z.enum(['public', 'request_only', 'private']).optional(),
    skill: optionalTrimmedString(80),
    location: optionalTrimmedString(80),
    isPrivate: z.boolean().optional(),
    avatar: optionalTrimmedString(500),
}).strict();

const feedCreateSchema = z.object({
    type: z.enum([
        'text',
        'voice',
        'image',
        'photo',
        'video',
        'bounty',
        'status',
        'job',
        'community',
        'academy',
    ]).default('text'),
    postType: z.enum(['job', 'bounty', 'community', 'academy', 'status']).optional(),
    visibility: z.enum(['public', 'connections', 'community', 'private']).optional(),
    content: z.string().trim().min(1).max(5000),
    mediaUrl: optionalTrimmedString(1000),
    media: z.array(z.object({
        url: optionalTrimmedString(1000),
        mimeType: optionalTrimmedString(120),
        sizeBytes: z.number().nonnegative().optional(),
    }).strict()).max(20).optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    bounty: z.object({
        reward: z.number().positive().optional(),
        currency: optionalTrimmedString(8),
        deadline: optionalTrimmedString(64),
    }).optional(),
}).strict().superRefine((payload, ctx) => {
    if (payload.type === 'bounty') {
        if (!payload.bounty || !Number.isFinite(payload.bounty.reward || NaN)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['bounty', 'reward'],
                message: 'bounty.reward is required for bounty posts',
            });
        }
    }
});

const bountyCreateSchema = z.object({
    title: z.string().trim().min(2).max(120),
    description: optionalTrimmedString(2000),
    reward: z.number().positive(),
    deadline: z.string().trim().min(8).max(64),
}).strict();

const chatSendSchema = z.object({
    applicationId: objectId,
    text: z.string().trim().min(1).max(5000),
    clientMessageId: optionalTrimmedString(120),
}).strict();

const applicationCreateSchema = z.object({
    jobId: objectId,
    workerId: objectId,
    initiatedBy: z.enum(['worker', 'employer']),
}).strict();

const applicationStatusUpdateSchema = z.object({
    status: z.enum([
        'applied',
        'shortlisted',
        'interview_requested',
        'interview_completed',
        'offer_sent',
        'offer_accepted',
        'offer_declined',
        'hired',
        'rejected',
        'withdrawn',
        // Legacy aliases accepted for backward-compatible clients.
        'requested',
        'pending',
        'accepted',
        'offer_proposed',
    ]),
}).strict();

const offerCreateSchema = z.object({
    applicationId: objectId,
    salaryOffered: z.number().nonnegative(),
    terms: z.string().trim().min(1).max(5000),
    expiryDate: z.string().trim().min(1).max(80),
    escrowEnabled: z.boolean().optional(),
}).strict();

const offerRespondSchema = z.object({
    action: z.enum(['accept', 'decline']),
}).strict();

const interviewScheduleCreateSchema = z.object({
    applicationId: objectId,
    scheduledTimeUTC: z.string().trim().min(1).max(80),
    timezone: z.string().trim().min(1).max(80),
}).strict();

const interviewScheduleRescheduleSchema = z.object({
    scheduledTimeUTC: z.string().trim().min(1).max(80),
    timezone: z.string().trim().min(1).max(80).optional(),
}).strict();

const smartInterviewStartSchema = z.object({
    maxSteps: z.number().int().min(1).max(20).optional(),
}).strict();

const smartInterviewTurnSchema = z.object({
    transcriptChunk: z.string().trim().min(1).max(10000),
}).strict();

const objectIdParamSchema = z.object({
    id: objectId,
}).strict();

module.exports = {
    signupSchema,
    loginSchema,
    refreshTokenSchema,
    logoutSchema,
    forgotPasswordSchema,
    resendVerificationSchema,
    resetPasswordSchema,
    otpSendSchema,
    otpVerifySchema,
    jobPostSchema,
    communityCreateSchema,
    feedCreateSchema,
    bountyCreateSchema,
    chatSendSchema,
    applicationCreateSchema,
    applicationStatusUpdateSchema,
    offerCreateSchema,
    offerRespondSchema,
    interviewScheduleCreateSchema,
    interviewScheduleRescheduleSchema,
    smartInterviewStartSchema,
    smartInterviewTurnSchema,
    objectIdParamSchema,
};
