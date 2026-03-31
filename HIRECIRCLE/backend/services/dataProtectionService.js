const RATE_WINDOW_MS = 60 * 60 * 1000;
const JOB_READ_LIMIT_PER_WINDOW = Number.parseInt(process.env.JOB_READ_LIMIT_PER_HOUR || '240', 10);
const API_READ_LIMIT_PER_WINDOW = Number.parseInt(process.env.PLATFORM_READ_LIMIT_PER_HOUR || '1200', 10);

const scrapeBuckets = new Map();

const toKey = ({ namespace, userId, ip }) => `${namespace}:${String(userId || 'anonymous')}::${String(ip || 'unknown')}`;

const consumeBucket = ({ namespace, userId, ip, max }) => {
    const key = toKey({ namespace, userId, ip });
    const now = Date.now();
    const row = scrapeBuckets.get(key);

    if (!row || row.expiresAt <= now) {
        scrapeBuckets.set(key, { count: 1, expiresAt: now + RATE_WINDOW_MS });
        return {
            allowed: true,
            remaining: Math.max(0, max - 1),
            retryAfterMs: RATE_WINDOW_MS,
        };
    }

    row.count += 1;
    scrapeBuckets.set(key, row);

    return {
        allowed: row.count <= max,
        remaining: Math.max(0, max - row.count),
        retryAfterMs: Math.max(1, row.expiresAt - now),
    };
};

const safeInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const enforceJobReadProtection = (req, res, next) => {
    const requestedLimit = safeInt(req.query.limit, 20);
    const requestedPage = safeInt(req.query.page, 1);

    if (requestedLimit > 100 || requestedPage > 50) {
        return res.status(429).json({
            message: 'Bulk job scraping is blocked',
            code: 'JOB_SCRAPE_BLOCKED',
        });
    }

    const userId = req.user?._id || null;
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const guard = consumeBucket({
        namespace: 'job_read',
        userId,
        ip,
        max: Math.max(20, JOB_READ_LIMIT_PER_WINDOW),
    });

    if (!guard.allowed) {
        return res.status(429).json({
            message: 'Job read rate limit exceeded',
            code: 'JOB_READ_RATE_LIMIT',
            retryAfterMs: guard.retryAfterMs,
        });
    }

    res.set('X-Job-Read-Remaining', String(guard.remaining));
    return next();
};

const enforcePlatformReadProtection = (req, res, next) => {
    const userId = req.platformClient?.apiKeyId || req.user?._id || null;
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';

    const guard = consumeBucket({
        namespace: 'platform_read',
        userId,
        ip,
        max: Math.max(100, API_READ_LIMIT_PER_WINDOW),
    });

    if (!guard.allowed) {
        return res.status(429).json({
            message: 'API scraping blocked - request rate too high',
            code: 'API_SCRAPE_BLOCKED',
            retryAfterMs: guard.retryAfterMs,
        });
    }

    res.set('X-Platform-Read-Remaining', String(guard.remaining));
    return next();
};

const resolveExportRequestType = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'job_history_export' || normalized === 'hire_history_export') return 'job_history_export';
    if (normalized === 'interview_history_export') return 'interview_history_export';
    return 'settings_data_export';
};

const buildExportPayload = ({
    user,
    settings,
    jobs = [],
    applications = [],
    requestType = 'settings_data_export',
}) => {
    const base = {
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            primaryRole: user.primaryRole,
            city: user.city,
            createdAt: user.createdAt,
        },
        generatedAt: new Date().toISOString(),
        requestType,
    };

    if (requestType === 'job_history_export') {
        return {
            ...base,
            jobs,
            hireHistory: applications.filter((row) => String(row.status || '').toLowerCase() === 'hired'),
            applicationHistory: applications,
        };
    }

    if (requestType === 'interview_history_export') {
        return {
            ...base,
            settings,
            interviews: settings?.interviewHistory || [],
        };
    }

    return {
        ...base,
        settings,
        jobs,
        applications,
    };
};

module.exports = {
    enforceJobReadProtection,
    enforcePlatformReadProtection,
    resolveExportRequestType,
    buildExportPayload,
};
