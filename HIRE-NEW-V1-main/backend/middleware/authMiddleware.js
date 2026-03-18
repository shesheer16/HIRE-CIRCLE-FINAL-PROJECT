const User = require('../models/userModel');
const { isRecruiter } = require('../utils/roleGuards');
const { applyRoleContractToUser } = require('../utils/userRoleContract');
const logger = require('../utils/logger');
const { verifyAccessToken } = require('../utils/tokenService');
const { isUserProfileMarkedComplete } = require('../services/profileCompletionService');

const PROFILE_GATED_ROUTE_PREFIXES = [
    '/api/jobs',
    '/api/applications',
    '/api/matches',
    '/api/match',
    '/api/apply',
];

const normalizePathname = (value = '') => String(value || '')
    .split('?')[0]
    .replace(/\/+$/, '');

const matchesPrefix = (pathname = '', prefix = '') => (
    pathname === prefix
    || pathname.startsWith(`${prefix}/`)
);

const resolveTokenVersion = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const issuedBeforePasswordChange = (decoded = {}, user = {}) => {
    const issuedAtMs = Number(decoded?.iat || 0) * 1000;
    const changedAtMs = user?.passwordChangedAt ? new Date(user.passwordChangedAt).getTime() : 0;
    if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0) return false;
    if (!Number.isFinite(changedAtMs) || changedAtMs <= 0) return false;
    return issuedAtMs < (changedAtMs - 1000);
};

const protect = async (req, res, next) => {
    const authorizationHeader = String(req.headers.authorization || '');
    if (!authorizationHeader.toLowerCase().startsWith('bearer ')) {
        return res.status(401).json({ message: 'Not authorized, no token' });
    }

    const token = authorizationHeader.slice(7).trim();
    if (!token) {
        return res.status(401).json({ message: 'Not authorized, no token' });
    }

    try {
        const decoded = await verifyAccessToken(token);
        const user = await User.findById(decoded.id).select('-password');
        if (!user || user.isDeleted) {
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
        if (user.isBanned) {
            return res.status(403).json({ message: 'Account is banned' });
        }
        const tokenVersion = resolveTokenVersion(decoded?.tv);
        const currentVersion = resolveTokenVersion(user?.tokenVersion);
        if (tokenVersion !== currentVersion) {
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
        if (issuedBeforePasswordChange(decoded, user)) {
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }

        req.user = applyRoleContractToUser(user);
        req.auth = decoded;
        req.authToken = token;
        // Exemption paths that bypassing profile completion gating (Auth routes don't usually hit protect, but covered just in case)
        const exemptPaths = [
            '/api/users/login',
            '/api/users/register',
            '/api/users/refresh-token',
            '/api/users/logout',
            '/api/users/forgotpassword',
            '/api/users/resetpassword',
            '/api/users/verifyemail',
            '/api/users/resendverification',
            '/api/users/profile/setup',
            '/api/users/profile/update',
            '/api/users/profile/complete',
            '/api/users/profile', // Usually needed to fetch their own profile to complete setup
            // Smart Interview onboarding must be reachable before full profile completion.
            '/api/upload/video',
            '/api/v2/upload/video',
            '/api/v2/interview-processing',
            '/health'
        ];

        // Ensure trailing slash agnostic matching
        const reqPath = normalizePathname(req.originalUrl);
        const isExempt = exemptPaths.some((ep) => matchesPrefix(reqPath, ep));
        const profileGatedRoute = PROFILE_GATED_ROUTE_PREFIXES.some((prefix) => matchesPrefix(reqPath, prefix));
        const hasCompletedProfile = isUserProfileMarkedComplete(user);

        if (user.otpVerified === false) {
            return res.status(403).json({ message: 'OTP verification required', code: 'OTP_NOT_VERIFIED' });
        }

        if (!isExempt) {

            // Jobs/matches/applications are blocked until profile completion.
            if (profileGatedRoute) {
                const activeRole = req.user?.activeRole || user.activeRole;
                const isEmployerJobsRoute = ['employer', 'recruiter'].includes(String(activeRole || '').toLowerCase())
                    && matchesPrefix(reqPath, '/api/jobs');
                const isWorkerJobsRoute = String(activeRole || '').toLowerCase() === 'worker'
                    && matchesPrefix(reqPath, '/api/jobs');
                if (!isEmployerJobsRoute && !isWorkerJobsRoute && !hasCompletedProfile) {
                    return res.status(403).json({
                        message: activeRole === 'employer'
                            ? 'Complete your Employer profile to continue hiring actions.'
                            : 'Complete your Job Seeker profile to unlock matches and applications.',
                        code: 'PROFILE_INCOMPLETE',
                    });
                }

                // Role-Specific Validations for profile-gated flows.
                if (activeRole === 'employer' && !isEmployerJobsRoute) {
                    const EmployerProfile = require('../models/EmployerProfile');
                    const empProfile = await EmployerProfile.findOne({ user: user._id });
                    if (!empProfile || !empProfile.companyName) {
                        return res.status(403).json({
                            message: 'Complete your Employer profile to continue hiring actions.',
                            code: 'PROFILE_INCOMPLETE_ROLE',
                        });
                    }
                } else if (activeRole === 'worker') {
                    const WorkerProfile = require('../models/WorkerProfile');
                    const workerProfile = await WorkerProfile.findOne({ user: user._id });
                    if (!workerProfile || !workerProfile.roleProfiles || workerProfile.roleProfiles.length === 0) {
                        return res.status(403).json({
                            message: 'Add at least one Job Seeker role profile to unlock matches and applications.',
                            code: 'PROFILE_INCOMPLETE_ROLE',
                        });
                    }
                }
            }
        }

        return next();
    } catch (error) {
        logger.security({
            event: 'auth_token_verification_failed',
            message: error.message,
            path: req.originalUrl,
            method: req.method,
        });
        return res.status(401).json({ message: 'Not authorized, token failed' });
    }
};

const admin = (req, res, next) => {
    if (req.user && req.user.isAdmin) {
        next();
    } else {
        res.status(403).json({ message: 'Not authorized as an admin' });
    }
};

const employer = (req, res, next) => {
    if (req.user && isRecruiter(req.user)) {
        next();
    } else {
        res.status(401).json({ message: 'Not authorized as an employer' });
    }
};

module.exports = { protect, admin, employer };
