const Application = require('../models/Application');
const Job = require('../models/Job');
const MatchPerformanceMetric = require('../models/MatchPerformanceMetric');
const MatchRun = require('../models/MatchRun');

const tokenize = (value) => {
    return new Set(
        String(value || '')
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .map((token) => token.trim())
            .filter((token) => token.length > 2)
    );
};

const hasTitleSimilarity = (left, right) => {
    const leftTokens = tokenize(left);
    const rightTokens = tokenize(right);
    if (!leftTokens.size || !rightTokens.size) return false;

    for (const token of leftTokens) {
        if (rightTokens.has(token)) return true;
    }

    return false;
};

const median = (values = []) => {
    const safe = values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);

    if (!safe.length) return null;
    const mid = Math.floor(safe.length / 2);
    if (safe.length % 2 === 0) {
        return (safe[mid - 1] + safe[mid]) / 2;
    }
    return safe[mid];
};

const resolveRejectedTitles = async (workerId) => {
    const since14d = new Date(Date.now() - (14 * 24 * 60 * 60 * 1000));
    const rejected = await Application.find({
        worker: workerId,
        status: 'rejected',
        createdAt: { $gte: since14d },
    })
        .select('job')
        .lean();

    const jobIds = Array.from(new Set(rejected.map((row) => String(row.job || '').trim()).filter(Boolean)));
    if (!jobIds.length) return [];

    const jobs = await Job.find({ _id: { $in: jobIds } })
        .select('title')
        .lean();

    return jobs
        .map((job) => String(job.title || '').trim())
        .filter(Boolean);
};

const resolveIgnoredStrongCount = async (workerId) => {
    const since7d = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));

    const strongViewed = await MatchPerformanceMetric.find({
        workerId,
        eventName: 'MATCH_RECOMMENDATION_VIEWED',
        matchTier: 'STRONG',
        timestamp: { $gte: since7d },
    })
        .select('jobId')
        .lean();

    const viewedJobIds = Array.from(new Set(
        strongViewed
            .map((row) => String(row.jobId || '').trim())
            .filter(Boolean)
    ));

    if (!viewedJobIds.length) {
        return {
            ignoredStrongCount: 0,
            viewedStrongCount: 0,
        };
    }

    const applications = await Application.find({
        worker: workerId,
        job: { $in: viewedJobIds },
        createdAt: { $gte: since7d },
    })
        .select('job')
        .lean();

    const appliedJobs = new Set(applications.map((row) => String(row.job || '').trim()).filter(Boolean));
    const ignoredStrongCount = viewedJobIds.filter((jobId) => !appliedJobs.has(jobId)).length;

    return {
        ignoredStrongCount,
        viewedStrongCount: viewedJobIds.length,
    };
};

const resolveSalaryMismatchTrend = async (workerId) => {
    const since30d = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
    const runs = await MatchRun.find({
        workerId,
        contextType: 'RECOMMENDED_JOBS',
        createdAt: { $gte: since30d },
    })
        .select('rejectReasonCounts')
        .lean();

    const salaryMismatchCount = runs.reduce((sum, row) => {
        return sum + Number(row?.rejectReasonCounts?.SALARY_OUTSIDE_RANGE || 0);
    }, 0);

    return {
        salaryMismatchCount,
        salaryMismatchTrendRepeated: salaryMismatchCount >= 3,
    };
};

const filterJobsByApplyIntent = async ({
    worker,
    jobs = [],
}) => {
    const workerId = String(worker?._id || '').trim();
    if (!workerId || !Array.isArray(jobs) || !jobs.length) {
        return {
            jobs,
            blocked: false,
            reasons: {},
            diagnostics: {
                ignoredStrongCount: 0,
                viewedStrongCount: 0,
                salaryMismatchCount: 0,
            },
        };
    }

    const [rejectedTitles, ignoredStrong, salaryTrend] = await Promise.all([
        resolveRejectedTitles(workerId),
        resolveIgnoredStrongCount(workerId),
        resolveSalaryMismatchTrend(workerId),
    ]);

    if (ignoredStrong.ignoredStrongCount >= 3) {
        return {
            jobs: [],
            blocked: true,
            reasons: {
                STRONG_MATCH_IGNORE_STREAK: jobs.length,
            },
            diagnostics: {
                ignoredStrongCount: ignoredStrong.ignoredStrongCount,
                viewedStrongCount: ignoredStrong.viewedStrongCount,
                salaryMismatchCount: salaryTrend.salaryMismatchCount,
            },
        };
    }

    const salaryExpectation = median(
        Array.isArray(worker.roleProfiles)
            ? worker.roleProfiles.map((role) => role?.expectedSalary)
            : []
    );

    const reasons = {
        RECENT_SIMILAR_REJECTION: 0,
        SALARY_MISMATCH_TREND: 0,
    };

    const filtered = jobs.filter((job) => {
        const title = String(job?.title || '').trim();

        if (rejectedTitles.some((rejectedTitle) => hasTitleSimilarity(title, rejectedTitle))) {
            reasons.RECENT_SIMILAR_REJECTION += 1;
            return false;
        }

        if (
            salaryTrend.salaryMismatchTrendRepeated
            && Number.isFinite(Number(salaryExpectation))
            && Number.isFinite(Number(job?.maxSalary))
            && Number(salaryExpectation) > Number(job.maxSalary) * 1.15
        ) {
            reasons.SALARY_MISMATCH_TREND += 1;
            return false;
        }

        return true;
    });

    return {
        jobs: filtered,
        blocked: false,
        reasons,
        diagnostics: {
            ignoredStrongCount: ignoredStrong.ignoredStrongCount,
            viewedStrongCount: ignoredStrong.viewedStrongCount,
            salaryMismatchCount: salaryTrend.salaryMismatchCount,
        },
    };
};

module.exports = {
    filterJobsByApplyIntent,
};
