import {
    demoProfile,
    demoUser,
    mockCourses,
    mockEnrolledCourses,
    mockMentors,
    mockNotifications,
} from './mockData';

const DEEP_CLONE = (value) => JSON.parse(JSON.stringify(value));

const DEMO_TOKEN = 'demo.eyJleHAiOjQxMDA4ODAwMDB9.signature';

const SCALE = {
    feedPosts: 1000,
    chatMessages: 500,
    jobs: 300,
    applications: 200,
    circles: 150,
    bounties: 100,
};

const JOB_TITLE_POOL = [
    'Warehouse Operations Lead',
    'Heavy Vehicle Driver',
    'Fleet Supervisor',
    'Dispatch Coordinator',
    'Inventory Controller',
    'Delivery Operations Executive',
];

const CITY_POOL = ['Hyderabad', 'Bangalore', 'Mumbai', 'Chennai', 'Pune', 'Delhi'];
const COMPANY_POOL = ['LogiTech India', 'Prime Movers', 'QuickDrop', 'SwiftFleet', 'MetroCargo', 'HubFlow'];
const FEED_TYPES = ['text', 'voice', 'photo', 'bounty'];
const CIRCLE_SKILLS = ['Logistics', 'Operations', 'Transport', 'Warehouse', 'Last-Mile', 'Dispatch'];

const cycle = (list, index) => list[index % list.length];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const generateJobs = (count) => (
    Array.from({ length: count }, (_, index) => {
        const city = cycle(CITY_POOL, index);
        const companyName = cycle(COMPANY_POOL, index);
        const title = `${cycle(JOB_TITLE_POOL, index)} ${Math.floor(index / JOB_TITLE_POOL.length) + 1}`;
        const baseSalary = 25000 + ((index % 18) * 1200);
        return {
            _id: `demo-job-${index + 1}`,
            title,
            companyName,
            companyId: `demo-company-${(index % 18) + 1}`,
            location: city,
            salaryRange: `₹${baseSalary.toLocaleString()} - ₹${(baseSalary + 9000).toLocaleString()}`,
            type: index % 4 === 0 ? 'Contract' : 'Full-time',
            requirements: [
                cycle(['Team Handling', 'Route Planning', 'Inventory', 'Compliance', 'Customer Ops'], index),
                cycle(['Shift Flexibility', 'Reporting', 'Safety', 'Vendor Coordination', 'KPI Tracking'], index + 1),
                cycle(['Field Execution', 'Problem Solving', 'Fleet Tracking', 'Warehouse SOP'], index + 2),
            ],
            createdAt: new Date(Date.now() - (index * 1800 * 1000)).toISOString(),
        };
    })
);

const generateApplications = (count, jobs) => (
    Array.from({ length: count }, (_, index) => {
        const job = jobs[index % jobs.length];
        const statusPool = ['requested', 'shortlisted', 'accepted', 'rejected', 'pending'];
        const status = cycle(statusPool, index);
        const workerId = `demo-worker-${(index % 80) + 1}`;
        const firstName = `Worker${(index % 80) + 1}`;
        return {
            _id: `demo-app-${index + 1}`,
            status,
            lastMessage: status === 'accepted'
                ? 'Offer shared. Please confirm joining.'
                : 'Your profile is under review.',
            updatedAt: new Date(Date.now() - (index * 900 * 1000)).toISOString(),
            matchScore: 75 + (index % 24),
            applicationStatus: status,
            initiatedBy: 'worker',
            job,
            worker: {
                _id: workerId,
                firstName,
                lastName: 'Candidate',
                name: `${firstName} Candidate`,
                city: cycle(CITY_POOL, index),
                totalExperience: 1 + (index % 12),
                roleProfiles: [{
                    roleName: cycle(JOB_TITLE_POOL, index),
                    experienceInRole: 1 + (index % 10),
                    skills: [
                        cycle(['Ops', 'Fleet', 'Warehouse', 'Dispatch', 'Customer Support'], index),
                        cycle(['Excel', 'Safety', 'Routing', 'Leadership', 'Inventory'], index + 2),
                    ],
                }],
            },
            employer: {
                _id: `demo-employer-${(index % 32) + 1}`,
                name: `Hiring Manager ${(index % 32) + 1}`,
                companyName: job.companyName,
                email: `hiring${(index % 32) + 1}@demo.company`,
                phone: `+91 98${String(10000000 + index).slice(-8)}`,
                website: 'https://demo.company',
                industry: 'Operations',
                location: job.location,
            },
        };
    })
);

const generateFeedPosts = (count) => (
    Array.from({ length: count }, (_, index) => {
        const type = cycle(FEED_TYPES, index);
        const author = `Member ${(index % 120) + 1}`;
        return {
            _id: `demo-feed-${index + 1}`,
            type,
            content: `Update ${index + 1}: ${cycle([
                'Need immediate staffing for morning shift.',
                'Completed route with improved delivery times.',
                'Looking for trained warehouse operators.',
                'Referral bonus open for operations supervisors.',
            ], index)}`,
            mediaUrl: type === 'photo'
                ? `https://images.unsplash.com/photo-${1580000000000 + index}?auto=format&fit=crop&w=1200&q=60`
                : '',
            createdAt: new Date(Date.now() - (index * 300 * 1000)).toISOString(),
            user: {
                _id: `demo-user-${(index % 140) + 1}`,
                name: author,
                primaryRole: index % 3 === 0 ? 'employer' : 'worker',
            },
            likes: Array.from({ length: index % 7 }, (_, likeIndex) => `u-${index}-${likeIndex}`),
            comments: Array.from({ length: index % 4 }, (_, commentIndex) => ({ text: `Comment ${commentIndex + 1}` })),
            reward: type === 'bounty' ? `₹${(2000 + (index % 6) * 500).toLocaleString()}` : undefined,
        };
    })
);

const generateCircles = (count) => (
    Array.from({ length: count }, (_, index) => {
        const id = `demo-circle-${index + 1}`;
        const members = [`demo-user-${(index % 150) + 1}`];
        if (index % 5 === 0) {
            members.push('demo-user-1');
        }
        return {
            _id: id,
            name: `${cycle(CIRCLE_SKILLS, index)} Circle ${Math.floor(index / CIRCLE_SKILLS.length) + 1}`,
            skill: cycle(CIRCLE_SKILLS, index),
            description: `Community ${index + 1} for ${cycle(CIRCLE_SKILLS, index)} professionals to share updates and opportunities.`,
            members,
        };
    })
);

const generateBounties = (count, jobs) => (
    Array.from({ length: count }, (_, index) => {
        const job = jobs[index % jobs.length];
        const bonusValue = 2000 + ((index % 12) * 400);
        return {
            id: `demo-bounty-${index + 1}`,
            company: job.companyName,
            role: job.title,
            bonus: `₹${bonusValue.toLocaleString()}`,
            bonusValue,
            totalPot: `₹${(bonusValue * 10).toLocaleString()}`,
            referrals: index % 25,
            expiresInDays: 1 + (index % 14),
            category: cycle(CIRCLE_SKILLS, index),
        };
    })
);

const jobsAtScale = generateJobs(SCALE.jobs);
const applicationsAtScale = generateApplications(SCALE.applications, jobsAtScale);
const feedPostsAtScale = generateFeedPosts(SCALE.feedPosts);
const circlesAtScale = generateCircles(SCALE.circles);
const bountiesAtScale = generateBounties(SCALE.bounties, jobsAtScale);

const DEFAULT_SETTINGS = {
    accountInfo: {
        name: demoUser.name || 'Demo User',
        email: demoUser.email || 'demo@hirecircle.in',
        emailReadOnly: false,
        phoneNumber: '+919876543210',
        city: demoProfile.city || 'Hyderabad',
        role: demoUser.primaryRole || 'worker',
        experienceLevel: demoProfile.totalExperience || 3,
        skillTags: (demoProfile.roleProfiles?.[0]?.skills || ['Warehouse', 'Dispatch']),
        profilePhoto: null,
    },
    notificationPreferences: {
        pushEnabled: true,
        smsEnabled: false,
        emailEnabled: true,
        notifyNewJobRecommendations: true,
        notifyInterviewReady: true,
        notifyApplicationStatus: true,
        notifyPromotions: true,
    },
    privacyPreferences: {
        profileVisibleToEmployers: true,
        showSalaryExpectation: true,
        showInterviewBadge: true,
        showLastActive: true,
        allowLocationSharing: true,
        locationVisibilityRadiusKm: 25,
    },
    matchPreferences: {
        maxCommuteDistanceKm: 25,
        salaryExpectationMin: 25000,
        salaryExpectationMax: 45000,
        preferredShiftTimes: ['Flexible'],
        roleClusters: ['Warehouse', 'Dispatch'],
        minimumMatchTier: 'GOOD',
    },
    security: {
        twoFactorEnabled: false,
        twoFactorMethod: 'email',
        linkedAccounts: {
            google: false,
            apple: false,
            emailPassword: true,
        },
    },
    featureToggles: {
        FEATURE_MATCH_UI_V1: true,
        FEATURE_PROBABILISTIC_MATCH: true,
        FEATURE_COLD_START_BOOST_SUGGESTIONS: false,
        FEATURE_MATCH_ALERTS: true,
        FEATURE_SETTINGS_ADVANCED: true,
        FEATURE_DETAILED_JOB_ANALYTICS: false,
        FEATURE_SMART_PUSH_TIMING: false,
    },
    canViewAdvanced: true,
};

const DEFAULT_BILLING_OVERVIEW = {
    planName: 'pro',
    billingPeriod: 'monthly',
    nextPaymentDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'active',
    planUsageSummary: {
        activeJobs: 4,
        availableCredits: 12,
        invoicesLast30d: 3,
        spendLast30dInr: 1497,
    },
    planLimits: {
        activeJobs: 25,
        monthlyBoostCredits: 20,
    },
};

const DEFAULT_INVOICES = [
    {
        invoiceId: 'demo-inv-1',
        eventType: 'subscription_charge',
        amountInr: 499,
        currency: 'inr',
        status: 'succeeded',
        issuedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
        invoiceId: 'demo-inv-2',
        eventType: 'boost_purchase',
        amountInr: 499,
        currency: 'inr',
        status: 'succeeded',
        issuedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    },
];

const state = {
    profile: DEEP_CLONE(demoProfile),
    jobs: DEEP_CLONE(jobsAtScale),
    applications: DEEP_CLONE(applicationsAtScale),
    feedPosts: DEEP_CLONE(feedPostsAtScale),
    notifications: DEEP_CLONE(mockNotifications),
    circles: DEEP_CLONE(circlesAtScale),
    bounties: DEEP_CLONE(bountiesAtScale),
    enrolledCourses: DEEP_CLONE(mockEnrolledCourses),
    interviewProcessingJobs: {},
    settings: DEEP_CLONE(DEFAULT_SETTINGS),
    billingOverview: DEEP_CLONE(DEFAULT_BILLING_OVERVIEW),
    invoices: DEEP_CLONE(DEFAULT_INVOICES),
};

let interviewDraftCounter = 1;

const nowIso = () => new Date().toISOString();

const normalizePath = (url = '') => {
    const withoutHost = String(url).replace(/^https?:\/\/[^/]+/i, '');
    return withoutHost.split('?')[0] || '/';
};

const normalizeRole = (role) => {
    const normalized = String(role || '').toLowerCase();
    if (normalized === 'recruiter' || normalized === 'employer') return 'recruiter';
    return 'candidate';
};

const primaryRoleFromLegacy = (role) => (role === 'recruiter' ? 'employer' : 'worker');

const buildAuthPayload = (email, role) => {
    const safeRole = normalizeRole(role);
    return {
        ...demoUser,
        email: email || demoUser.email,
        role: safeRole,
        primaryRole: primaryRoleFromLegacy(safeRole),
        token: DEMO_TOKEN,
    };
};

const buildMatches = () => state.jobs.map((job, index) => ({
    job,
    matchScore: 75 + (index % 24),
    whyYouFit: `Your experience aligns strongly with ${job.title}.`,
    tier: index === 0 ? 'A' : 'B',
    labels: ['Skill Fit', 'Location Fit'],
}));

const getTierForProbability = (probability) => {
    if (probability >= 0.85) return 'STRONG';
    if (probability >= 0.7) return 'GOOD';
    if (probability >= 0.6) return 'POSSIBLE';
    return 'REJECT';
};

const buildRecommendedJobs = ({ city = '', roleCluster = '' } = {}) => {
    const normalizedCity = String(city || '').trim().toLowerCase();
    const normalizedRoleCluster = String(roleCluster || '').trim().toLowerCase();

    const filtered = state.jobs.filter((job) => {
        const cityMatch = !normalizedCity || String(job?.location || '').toLowerCase() === normalizedCity;
        const roleMatch = !normalizedRoleCluster || String(job?.title || '').toLowerCase().includes(normalizedRoleCluster);
        return cityMatch && roleMatch;
    });

    return filtered.slice(0, 20).map((job, index) => {
        const probability = clamp(0.92 - (index * 0.017), 0.45, 0.99);
        return {
            job,
            matchScore: Math.round(probability * 100),
            matchProbability: probability,
            tier: getTierForProbability(probability),
            tierLabel: getTierForProbability(probability),
            explainability: {
                skillScore: clamp(0.82 - (index * 0.01), 0.45, 0.95),
                experienceScore: clamp(0.8 - (index * 0.008), 0.45, 0.95),
                salaryScore: clamp(0.78 - (index * 0.009), 0.45, 0.95),
                distanceScore: clamp(0.76 - (index * 0.007), 0.45, 0.95),
            },
        };
    }).filter((row) => row.matchProbability >= 0.62);
};

const buildEmployerMatches = (jobId) => {
    const relevant = state.applications.filter((application) => String(application.job?._id) === String(jobId));
    return relevant.map((application, index) => ({
        worker: application.worker,
        matchScore: Math.max(75, 92 - (index * 3)),
        tier: index === 0 ? 'A' : 'B',
        labels: ['Experience', 'Reliability'],
        applicationId: application._id,
        applicationStatus: application.status,
    }));
};

const buildPulseItems = () => state.jobs.map((job) => ({
    _id: job._id,
    title: job.title,
    companyName: job.companyName,
    salaryRange: job.salaryRange,
    requirements: job.requirements,
    createdAt: job.createdAt,
}));

const buildInterviewExtractionForRole = (role) => {
    if (role === 'employer') {
        return {
            jobTitle: 'Warehouse Shift Lead',
            companyName: state.profile?.companyName || 'LogiTech India',
            requiredSkills: ['Inventory', 'Team Handling', 'Dispatch'],
            experienceRequired: '2+ years',
            salaryRange: '₹28,000 - ₹36,000',
            shift: 'day',
            location: 'Hyderabad',
            description: 'Lead daily warehouse operations and coordinate dispatch workflow.',
            confidenceScore: 84,
        };
    }

    return {
        name: `${state.profile?.firstName || 'Lokesh'} ${state.profile?.lastName || 'Demo'}`.trim(),
        roleTitle: 'Warehouse Associate',
        skills: ['Inventory', 'Packing', 'Dispatch Support'],
        experienceYears: 3,
        expectedSalary: '25000',
        preferredShift: 'flexible',
        location: 'Hyderabad',
        summary: 'Reliable warehouse operations professional with dispatch support experience.',
        confidenceScore: 82,
    };
};

const buildChatMessagesFor = (applicationId) => {
    const appId = String(applicationId || 'demo-app-1');
    const appIndex = Number(appId.replace(/\D+/g, '')) || 1;
    return Array.from({ length: SCALE.chatMessages }, (_, index) => {
        const isEmployer = index % 2 === 0;
        const sender = isEmployer ? `demo-employer-${(appIndex % 32) + 1}` : 'demo-user-1';
        return {
            _id: `${appId}-msg-${index + 1}`,
            sender,
            type: index % 75 === 0 ? 'file' : 'text',
            text: `Chat message ${index + 1} for ${appId}`,
            fileName: index % 75 === 0 ? `Document_${index + 1}.pdf` : undefined,
            fileUrl: index % 75 === 0 ? 'https://example.com/demo/uploaded-file.pdf' : undefined,
            fileSize: index % 75 === 0 ? 240000 + index : undefined,
            createdAt: new Date(Date.now() - ((SCALE.chatMessages - index) * 45 * 1000)).toISOString(),
        };
    });
};

const makeResponse = (config, data, status = 200) => ({
    data,
    status,
    statusText: 'OK',
    headers: {},
    config,
});

export const getMockApiResponse = (config = {}) => {
    const method = String(config.method || 'get').toLowerCase();
    const path = normalizePath(config.url);
    let body = config.data || {};
    if (typeof config.data === 'string') {
        try {
            body = JSON.parse(config.data);
        } catch {
            body = {};
        }
    }
    const params = config.params || {};

    if (method === 'post' && path === '/api/users/login') {
        const role = normalizeRole(body.role || (String(body.email || '').includes('employer') ? 'recruiter' : 'candidate'));
        return makeResponse(config, buildAuthPayload(body.email, role));
    }

    if (method === 'post' && path === '/api/users/register') {
        const role = normalizeRole(body.role);
        return makeResponse(config, buildAuthPayload(body.email, role));
    }

    if (method === 'get' && path === '/api/users/profile') {
        return makeResponse(config, { profile: state.profile });
    }

    if (method === 'put' && path === '/api/users/profile') {
        state.profile = {
            ...state.profile,
            ...body,
        };
        if (body.firstName || body.lastName) {
            state.profile.firstName = body.firstName || state.profile.firstName;
            state.profile.lastName = body.lastName || state.profile.lastName;
        }
        return makeResponse(config, { success: true, profile: state.profile });
    }

    if (method === 'get' && path === '/api/settings') {
        return makeResponse(config, {
            ...DEEP_CLONE(state.settings),
            billingOverview: DEEP_CLONE(state.billingOverview),
        });
    }

    if (method === 'put' && path === '/api/settings') {
        state.settings = {
            ...state.settings,
            ...(body.accountInfo ? {
                accountInfo: {
                    ...state.settings.accountInfo,
                    ...body.accountInfo,
                },
            } : {}),
            ...(body.notificationPreferences ? {
                notificationPreferences: {
                    ...state.settings.notificationPreferences,
                    ...body.notificationPreferences,
                },
            } : {}),
            ...(body.privacyPreferences ? {
                privacyPreferences: {
                    ...state.settings.privacyPreferences,
                    ...body.privacyPreferences,
                },
            } : {}),
            ...(body.matchPreferences ? {
                matchPreferences: {
                    ...state.settings.matchPreferences,
                    ...body.matchPreferences,
                },
            } : {}),
            ...(body.featureToggles ? {
                featureToggles: {
                    ...state.settings.featureToggles,
                    ...body.featureToggles,
                },
            } : {}),
        };

        return makeResponse(config, {
            success: true,
            changedFields: Object.keys(body || {}),
            settings: DEEP_CLONE(state.settings),
        });
    }

    if (method === 'post' && path === '/api/settings/notification-preferences') {
        state.settings.notificationPreferences = {
            ...state.settings.notificationPreferences,
            ...body,
        };
        return makeResponse(config, {
            success: true,
            notificationPreferences: DEEP_CLONE(state.settings.notificationPreferences),
        });
    }

    if (method === 'post' && path === '/api/settings/privacy') {
        state.settings.privacyPreferences = {
            ...state.settings.privacyPreferences,
            ...body,
        };
        return makeResponse(config, {
            success: true,
            privacyPreferences: DEEP_CLONE(state.settings.privacyPreferences),
        });
    }

    if (method === 'post' && path === '/api/settings/security') {
        state.settings.security = {
            ...state.settings.security,
            ...body,
            linkedAccounts: {
                ...state.settings.security.linkedAccounts,
                ...(body.linkedAccounts || {}),
            },
        };
        return makeResponse(config, {
            success: true,
            security: DEEP_CLONE(state.settings.security),
        });
    }

    if (method === 'post' && path === '/api/settings/data-download') {
        return makeResponse(config, {
            success: true,
            requestId: `demo-export-${Date.now()}`,
            status: 'ready',
            downloadUrl: 'https://example.com/demo/settings-export.json',
        }, 202);
    }

    if (method === 'delete' && path === '/api/settings/account') {
        return makeResponse(config, { success: true, message: 'Account deleted (demo).' });
    }

    if (method === 'get' && path === '/api/settings/billing-overview') {
        return makeResponse(config, {
            success: true,
            billingOverview: DEEP_CLONE(state.billingOverview),
        });
    }

    if (method === 'get' && path === '/api/settings/invoices') {
        return makeResponse(config, {
            success: true,
            invoices: DEEP_CLONE(state.invoices),
        });
    }

    if (method === 'delete' && path === '/api/users/delete') {
        return makeResponse(config, { success: true });
    }

    if (method === 'post' && (path === '/api/users/resendverification' || path === '/api/auth/resend-otp' || path === '/api/auth/verify-otp' || path === '/api/auth/forgot-password')) {
        return makeResponse(config, { success: true, message: 'Demo request processed.' });
    }

    if (method === 'get' && path === '/api/matches/candidate') {
        return makeResponse(config, buildMatches());
    }

    if (method === 'get' && path === '/api/jobs/recommended') {
        let recommendedJobs = buildRecommendedJobs({
            city: params.city,
            roleCluster: params.roleCluster,
        });

        const includePreferences = ['true', '1', 'yes', 'on'].includes(String(params.preferences || '').toLowerCase());
        if (includePreferences) {
            const minTier = String(state.settings?.matchPreferences?.minimumMatchTier || 'POSSIBLE').toUpperCase();
            const tierRank = { STRONG: 3, GOOD: 2, POSSIBLE: 1, REJECT: 0 };
            const minRank = tierRank[minTier] || 1;

            recommendedJobs = recommendedJobs.filter((row) => (tierRank[String(row.tier || '').toUpperCase()] || 0) >= minRank);
        }

        return makeResponse(config, {
            recommendedJobs,
            matchModelVersionUsed: 'demo-v1',
            appliedPreferences: includePreferences ? DEEP_CLONE(state.settings?.matchPreferences || {}) : null,
        });
    }

    if (method === 'get' && path === '/api/matches/probability') {
        const jobId = String(params.jobId || '');
        const index = state.jobs.findIndex((job) => String(job?._id) === jobId);
        const probability = clamp(index >= 0 ? 0.91 - (index * 0.017) : 0.74, 0.45, 0.99);

        return makeResponse(config, {
            matchProbability: probability,
            matchModelVersionUsed: 'demo-v1',
            fallbackUsed: false,
            explainability: {
                skillImpact: clamp(0.86 - (Math.max(index, 0) * 0.009), 0.4, 0.95),
                experienceImpact: clamp(0.81 - (Math.max(index, 0) * 0.008), 0.4, 0.95),
                salaryImpact: clamp(0.78 - (Math.max(index, 0) * 0.007), 0.4, 0.95),
                distanceImpact: clamp(0.75 - (Math.max(index, 0) * 0.006), 0.4, 0.95),
                reliabilityImpact: clamp(0.73 - (Math.max(index, 0) * 0.005), 0.4, 0.95),
            },
        });
    }

    const employerMatch = path.match(/^\/api\/matches\/employer\/([^/]+)$/);
    if (method === 'get' && employerMatch) {
        return makeResponse(config, { matches: buildEmployerMatches(employerMatch[1]) });
    }

    if (method === 'post' && path === '/api/matches/explain') {
        return makeResponse(config, {
            explanation: [
                'Strong role alignment based on experience and skills.',
                'Location and compensation expectations are compatible.',
                'High reliability indicators from similar roles.',
            ],
        });
    }

    if (method === 'post' && path === '/api/matches/feedback') {
        return makeResponse(config, { success: true });
    }

    if (method === 'get' && path === '/api/jobs/my-jobs') {
        return makeResponse(config, DEEP_CLONE(state.jobs));
    }

    if (method === 'get' && path === '/api/jobs') {
        const companyId = params.companyId;
        const filtered = companyId ? state.jobs.filter((job) => String(job.companyId || 'demo-company') === String(companyId)) : state.jobs;
        return makeResponse(config, { data: DEEP_CLONE(filtered) });
    }

    if (method === 'post' && path === '/api/jobs/suggest') {
        return makeResponse(config, {
            suggestions: '2+ years relevant experience, Shift flexibility, Team coordination, Basic digital reporting skills',
        });
    }

    if (method === 'post' && path === '/api/jobs') {
        const created = {
            _id: `demo-job-${Date.now()}`,
            title: body.title || 'New Opportunity',
            companyName: body.companyName || 'Demo Company',
            location: body.location || 'Remote',
            salaryRange: body.salaryRange || 'Negotiable',
            type: 'Full-time',
            requirements: body.requirements || [],
            createdAt: nowIso(),
        };
        state.jobs.unshift(created);
        return makeResponse(config, { success: true, job: created }, 201);
    }

    const updateJobPath = path.match(/^\/api\/jobs\/([^/]+)$/);
    if (method === 'put' && updateJobPath) {
        const jobId = updateJobPath[1];
        let updatedJob = null;

        state.jobs = state.jobs.map((job) => {
            if (String(job._id) !== String(jobId)) return job;

            updatedJob = {
                ...job,
                ...(body.title ? { title: body.title } : {}),
                ...(body.companyName ? { companyName: body.companyName } : {}),
                ...(body.salaryRange ? { salaryRange: body.salaryRange } : {}),
                ...(body.location ? { location: body.location } : {}),
                ...(body.requirements ? { requirements: Array.isArray(body.requirements) ? body.requirements : String(body.requirements).split(',').map((item) => item.trim()).filter(Boolean) } : {}),
                ...(body.status ? { status: body.status, isOpen: body.status === 'active' } : {}),
                updatedAt: nowIso(),
            };

            return updatedJob;
        });

        if (!updatedJob) {
            return makeResponse(config, { success: false, message: 'Job not found' }, 404);
        }

        return makeResponse(config, { success: true, data: DEEP_CLONE(updatedJob), signalFinalized: true });
    }

    if (method === 'get' && path === '/api/applications') {
        return makeResponse(config, DEEP_CLONE(state.applications));
    }

    if (method === 'post' && path === '/api/applications') {
        const selectedJob = state.jobs.find((job) => String(job._id) === String(body.jobId)) || state.jobs[0];
        const application = {
            _id: `demo-app-${Date.now()}`,
            status: 'accepted',
            lastMessage: 'Application accepted. Start chat now.',
            updatedAt: nowIso(),
            matchScore: 90,
            initiatedBy: body.initiatedBy || 'worker',
            job: selectedJob,
            worker: {
                _id: 'demo-worker-1',
                firstName: 'Lokesh',
                lastName: 'Demo',
                name: 'Lokesh Demo',
                city: 'Hyderabad',
                totalExperience: 5,
                roleProfiles: state.profile.roleProfiles || [],
            },
            employer: {
                _id: `demo-employer-${selectedJob._id}`,
                name: 'Demo Hiring Manager',
                companyName: selectedJob.companyName,
                email: 'hiring@demo.company',
                phone: '+91 99999 00000',
                website: 'https://demo.company',
                industry: 'Operations',
                location: selectedJob.location,
            },
        };
        state.applications.unshift(application);
        return makeResponse(config, { application }, 201);
    }

    const applicationStatusPath = path.match(/^\/api\/applications\/([^/]+)\/status$/);
    if (method === 'put' && applicationStatusPath) {
        const id = applicationStatusPath[1];
        state.applications = state.applications.map((application) => (
            String(application._id) === String(id)
                ? { ...application, status: body.status || application.status, updatedAt: nowIso() }
                : application
        ));
        return makeResponse(config, { success: true });
    }

    const applicationByIdPath = path.match(/^\/api\/applications\/([^/]+)$/);
    if (method === 'get' && applicationByIdPath) {
        const id = applicationByIdPath[1];
        const application = state.applications.find((item) => String(item._id) === String(id)) || state.applications[0];
        return makeResponse(config, { application: DEEP_CLONE(application) });
    }

    const chatByIdPath = path.match(/^\/api\/chat\/([^/]+)$/);
    if (method === 'get' && chatByIdPath) {
        return makeResponse(config, buildChatMessagesFor(chatByIdPath[1]));
    }

    if (method === 'post' && path === '/api/chat/upload') {
        return makeResponse(config, { url: 'https://example.com/demo/uploaded-file.pdf' });
    }

    if (method === 'post' && path === '/api/reports') {
        return makeResponse(config, { success: true });
    }

    if (method === 'get' && path === '/api/feed/posts') {
        const page = Math.max(1, Number(params.page || 1));
        const limit = Math.max(1, Number(params.limit || 10));
        const start = (page - 1) * limit;
        const end = start + limit;
        const paginated = state.feedPosts.slice(start, end);
        return makeResponse(config, {
            posts: DEEP_CLONE(paginated),
            hasMore: end < state.feedPosts.length,
        });
    }

    if (method === 'post' && path === '/api/feed/posts') {
        const created = {
            _id: `demo-feed-${Date.now()}`,
            type: body.type || 'text',
            content: body.content || '',
            mediaUrl: '',
            createdAt: nowIso(),
            user: { _id: demoUser._id, name: demoUser.name, primaryRole: demoUser.primaryRole },
            likes: [],
            comments: [],
        };
        state.feedPosts.unshift(created);
        return makeResponse(config, { post: created }, 201);
    }

    const feedLikePath = path.match(/^\/api\/feed\/posts\/([^/]+)\/like$/);
    if (method === 'post' && feedLikePath) {
        const post = state.feedPosts.find((item) => String(item._id) === String(feedLikePath[1]));
        if (!post) {
            return makeResponse(config, { liked: false, likesCount: 0 });
        }
        const likeSet = new Set(post.likes || []);
        const demoLikeId = 'demo-user-like';
        if (likeSet.has(demoLikeId)) {
            likeSet.delete(demoLikeId);
        } else {
            likeSet.add(demoLikeId);
        }
        post.likes = [...likeSet];
        return makeResponse(config, { liked: likeSet.has(demoLikeId), likesCount: post.likes.length });
    }

    const feedCommentPath = path.match(/^\/api\/feed\/posts\/([^/]+)\/comments$/);
    if (method === 'post' && feedCommentPath) {
        const post = state.feedPosts.find((item) => String(item._id) === String(feedCommentPath[1]));
        if (post) {
            post.comments = [...(post.comments || []), { text: body.text || '' }];
        }
        return makeResponse(config, { success: true });
    }

    if (method === 'get' && path === '/api/pulse') {
        return makeResponse(config, { items: buildPulseItems() });
    }

    if (method === 'get' && path === '/api/academy/courses') {
        const courses = mockCourses.map((course) => ({
            ...course,
            mentor: mockMentors[0].name,
        }));
        return makeResponse(config, { courses });
    }

    if (method === 'get' && path === '/api/academy/enrolled') {
        return makeResponse(config, { enrolled: DEEP_CLONE(state.enrolledCourses) });
    }

    const academyEnrollPath = path.match(/^\/api\/academy\/courses\/([^/]+)\/enroll$/);
    if (method === 'post' && academyEnrollPath) {
        const courseId = academyEnrollPath[1];
        if (!state.enrolledCourses.some((item) => String(item.courseId) === String(courseId))) {
            state.enrolledCourses.push({ courseId });
        }
        return makeResponse(config, { success: true });
    }

    if (method === 'get' && path === '/api/growth/referrals') {
        return makeResponse(config, {
            totalEarnings: 18500 + (state.bounties.length * 85),
            successfulReferrals: 7 + Math.floor(state.bounties.length / 20),
            pendingReferrals: 2 + Math.floor(state.bounties.length / 35),
            bounties: DEEP_CLONE(state.bounties),
        });
    }

    if (method === 'post' && path === '/api/growth/referrals') {
        return makeResponse(config, { success: true });
    }

    const shareLinkPath = path.match(/^\/api\/growth\/share-link\/job\/([^/]+)$/);
    if (method === 'get' && shareLinkPath) {
        return makeResponse(config, { shareLink: `https://hirecircle.demo/ref/${shareLinkPath[1]}` });
    }

    if (method === 'get' && path === '/api/circles') {
        return makeResponse(config, { circles: DEEP_CLONE(state.circles) });
    }

    if (method === 'get' && path === '/api/circles/my') {
        const mine = state.circles.filter((circle) => Array.isArray(circle.members) && circle.members.includes('demo-user-1'));
        return makeResponse(config, { circles: DEEP_CLONE(mine) });
    }

    const circleJoinPath = path.match(/^\/api\/circles\/([^/]+)\/join$/);
    if (method === 'post' && circleJoinPath) {
        state.circles = state.circles.map((circle) => {
            if (String(circle._id) !== String(circleJoinPath[1])) return circle;
            const members = new Set(circle.members || []);
            members.add('demo-user-1');
            return { ...circle, members: [...members] };
        });
        return makeResponse(config, { success: true });
    }

    if (method === 'get' && path === '/api/notifications') {
        return makeResponse(config, { notifications: DEEP_CLONE(state.notifications) });
    }

    if (method === 'put' && path === '/api/notifications') {
        state.notifications = state.notifications.map((notification) => ({ ...notification, isRead: true }));
        return makeResponse(config, { success: true });
    }

    const notificationReadPath = path.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (method === 'put' && notificationReadPath) {
        state.notifications = state.notifications.map((notification) => (
            String(notification._id) === String(notificationReadPath[1])
                ? { ...notification, isRead: true }
                : notification
        ));
        return makeResponse(config, { success: true });
    }

    if (method === 'post' && path === '/api/notifications/register-token') {
        return makeResponse(config, { success: true });
    }

    const organizationPath = path.match(/^\/api\/organizations\/([^/]+)$/);
    if (method === 'get' && organizationPath) {
        return makeResponse(config, {
            organization: {
                _id: organizationPath[1],
                name: 'LogiTech India',
                location: 'Hyderabad',
                industry: 'Logistics',
                website: 'https://logitech.in',
                logoUrl: null,
            },
        });
    }

    if (method === 'post' && path === '/api/v2/upload/video') {
        const role = state.profile?.primaryRole === 'employer' ? 'employer' : 'worker';
        const processingId = `demo-processing-${Date.now()}`;
        const extractedData = buildInterviewExtractionForRole(role);
        let createdJobId = null;

        if (role === 'employer') {
            const draftJob = {
                _id: `demo-draft-job-${interviewDraftCounter++}`,
                title: extractedData.jobTitle || 'Open Position',
                companyName: extractedData.companyName || 'LogiTech India',
                location: extractedData.location || 'Hyderabad',
                salaryRange: extractedData.salaryRange || 'Negotiable',
                requirements: extractedData.requiredSkills || [],
                status: 'draft_from_ai',
                isOpen: false,
                createdAt: nowIso(),
            };
            state.jobs.unshift(draftJob);
            createdJobId = draftJob._id;
        }

        state.interviewProcessingJobs[processingId] = {
            status: 'pending',
            role,
            createdAt: Date.now(),
            extractedData,
            createdJobId,
            errorMessage: null,
            videoUrl: 'https://example.com/demo/profile-video.mp4',
        };

        return makeResponse(config, {
            success: true,
            processingId,
            videoUrl: 'https://example.com/demo/profile-video.mp4',
        }, 202);
    }

    if (method === 'get' && path === '/api/v2/interview-processing/latest') {
        const entries = Object.entries(state.interviewProcessingJobs);
        if (!entries.length) {
            return makeResponse(config, { processingId: null, status: null });
        }

        const unresolved = entries
            .map(([id, job]) => ({ id, ...job }))
            .filter((job) => job.status === 'pending' || job.status === 'processing')
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

        if (!unresolved.length) {
            return makeResponse(config, { processingId: null, status: null });
        }

        return makeResponse(config, {
            processingId: unresolved[0].id,
            status: unresolved[0].status,
        });
    }

    const interviewProcessingPath = path.match(/^\/api\/v2\/interview-processing\/([^/]+)$/);
    if (method === 'get' && interviewProcessingPath) {
        const processingId = interviewProcessingPath[1];
        const job = state.interviewProcessingJobs[processingId];
        if (!job) {
            return makeResponse(config, { message: 'Interview processing job not found.' }, 404);
        }

        const elapsed = Date.now() - Number(job.createdAt || Date.now());
        if (elapsed > 12000) {
            job.status = 'completed';
        } else if (elapsed > 4000) {
            job.status = 'processing';
        } else {
            job.status = 'pending';
        }

        return makeResponse(config, {
            status: job.status,
            extractedData: job.status === 'completed' ? DEEP_CLONE(job.extractedData) : null,
            createdJobId: job.status === 'completed' ? job.createdJobId : null,
            errorMessage: job.errorMessage || null,
        });
    }

    if (method === 'post' && path === '/api/upload/video') {
        return makeResponse(config, { videoUrl: 'https://example.com/demo/profile-video.mp4' });
    }

    if (method === 'post' && path === '/api/payments/create-intent') {
        return makeResponse(config, {
            clientSecret: 'pi_demo_secret_123',
            paymentIntentId: 'pi_demo_123',
            amount: body.amount || 0,
            currency: 'inr',
        });
    }

    if (method === 'get' && path === '/api/admin/stats') {
        return makeResponse(config, {
            totalUsers: 1247,
            activeJobs: 342,
            pendingReports: 89,
        });
    }

    if (method === 'get' && path.startsWith('/api/admin/users')) {
        return makeResponse(config, { users: [demoUser], total: 1 });
    }

    if (method === 'get' && path.startsWith('/api/admin/jobs')) {
        return makeResponse(config, { jobs: DEEP_CLONE(state.jobs), total: state.jobs.length });
    }

    if (method === 'get' && path.startsWith('/api/admin/reports')) {
        return makeResponse(config, { reports: [], total: 0 });
    }

    return makeResponse(config, { success: true });
};

export const getMockDatasetSummary = () => {
    const uniqueUsers = new Set(['demo-user-1']);
    state.applications.forEach((application) => {
        if (application?.worker?._id) uniqueUsers.add(String(application.worker._id));
        if (application?.employer?._id) uniqueUsers.add(String(application.employer._id));
    });
    state.feedPosts.forEach((post) => {
        if (post?.user?._id) uniqueUsers.add(String(post.user._id));
    });
    state.circles.forEach((circle) => {
        (circle?.members || []).forEach((memberId) => {
            if (memberId) uniqueUsers.add(String(memberId));
        });
    });

    const totalLikes = state.feedPosts.reduce((sum, post) => sum + ((post?.likes || []).length), 0);
    const totalComments = state.feedPosts.reduce((sum, post) => sum + ((post?.comments || []).length), 0);
    const totalReferrals = state.bounties.reduce((sum, bounty) => sum + Number(bounty?.referrals || 0), 0);

    return {
        totalMockUsers: uniqueUsers.size,
        totalApplications: state.applications.length,
        totalMatches: state.jobs.length,
        totalFeedPosts: state.feedPosts.length,
        totalCircles: state.circles.length,
        totalBounties: state.bounties.length,
        engagement: {
            totalLikes,
            totalComments,
            totalReferrals,
            avgLikesPerPost: state.feedPosts.length ? Number((totalLikes / state.feedPosts.length).toFixed(2)) : 0,
            avgCommentsPerPost: state.feedPosts.length ? Number((totalComments / state.feedPosts.length).toFixed(2)) : 0,
        },
    };
};
