const AnalyticsEvent = require('../models/AnalyticsEvent');
const ConversionMilestone = require('../models/ConversionMilestone');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');

const logWarning = (taskName, error, context = {}) => {
    console.warn(JSON.stringify({
        event: 'revenue_instrumentation_warning',
        taskName,
        message: error?.message || 'unknown error',
        context,
    }));
};

const fireAndForget = (taskName, fn, context = {}) => {
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
        return;
    }
    setImmediate(async () => {
        try {
            await fn();
        } catch (error) {
            logWarning(taskName, error, context);
        }
    });
};

const createAnalyticsEvent = async ({ userId, eventName, metadata = {} }) => {
    if (!eventName) return;
    await AnalyticsEvent.create({
        user: userId || null,
        eventName,
        metadata,
    });
};

const normalizeSalaryBand = (salaryRange = '') => {
    const value = String(salaryRange || '');
    const numbers = value.match(/\d+/g)?.map((num) => Number(num)) || [];
    const min = numbers.length ? Math.min(...numbers) : 0;

    if (min <= 15000) return '0-15k';
    if (min <= 25000) return '15k-25k';
    if (min <= 40000) return '25k-40k';
    return '40k+';
};

const recordLifecycleEvent = async ({
    eventType,
    employerId = null,
    workerId = null,
    userId = null,
    jobId = null,
    applicationId = null,
    city = 'Hyderabad',
    roleCluster = 'general',
    salaryBand = 'unknown',
    shift = 'unknown',
    metadata = {},
    occurredAt = new Date(),
}) => {
    if (!eventType) return;

    await HiringLifecycleEvent.create({
        eventType,
        employerId,
        workerId,
        userId,
        jobId,
        applicationId,
        city: city || 'Hyderabad',
        roleCluster: roleCluster || 'general',
        salaryBand: salaryBand || 'unknown',
        shift: shift || 'unknown',
        occurredAt,
        metadata,
    });
};

const markMilestoneOnce = async ({
    employerId,
    field,
    timestamp = new Date(),
    city = null,
    roleCluster = null,
    extraSet = {},
}) => {
    if (!employerId || !field) return false;

    const update = {
        $setOnInsert: {
            employerId,
            city: city || null,
            roleCluster: roleCluster || null,
        },
        $set: {
            [field]: timestamp,
            ...(city ? { city } : {}),
            ...(roleCluster ? { roleCluster } : {}),
            ...extraSet,
        },
    };

    const result = await ConversionMilestone.updateOne(
        { employerId, [field]: null },
        update,
        { upsert: true }
    );

    return Boolean(result?.modifiedCount || result?.upsertedCount);
};

const markEmployerSignedUpOnce = async ({ employerId, city = null, roleCluster = null }) => {
    const marked = await markMilestoneOnce({
        employerId,
        field: 'signedUpAt',
        city,
        roleCluster,
    });

    if (marked) {
        await createAnalyticsEvent({
            userId: employerId,
            eventName: 'EMPLOYER_SIGNED_UP',
            metadata: { city, roleCluster },
        });
    }
};

const markFirstJobDraftCreatedOnce = async ({ employerId, jobId = null, city = null, roleCluster = null }) => {
    const marked = await markMilestoneOnce({
        employerId,
        field: 'firstJobDraftCreatedAt',
        city,
        roleCluster,
    });

    if (marked) {
        await createAnalyticsEvent({
            userId: employerId,
            eventName: 'EMPLOYER_FIRST_JOB_CREATED',
            metadata: { city, roleCluster, jobId: jobId ? String(jobId) : null },
        });
    }
};

const markFirstJobActivatedOnce = async ({ employerId, jobId = null, city = null }) => {
    const marked = await markMilestoneOnce({
        employerId,
        field: 'firstJobActivatedAt',
        city,
    });

    if (marked) {
        await createAnalyticsEvent({
            userId: employerId,
            eventName: 'EMPLOYER_FIRST_JOB_ACTIVATED',
            metadata: { city, jobId: jobId ? String(jobId) : null },
        });
    }
};

const markFirstShortlistOnce = async ({ employerId, applicationId = null, jobId = null, city = null }) => {
    const marked = await markMilestoneOnce({
        employerId,
        field: 'firstShortlistAt',
        city,
    });

    if (marked) {
        await createAnalyticsEvent({
            userId: employerId,
            eventName: 'EMPLOYER_FIRST_SHORTLIST',
            metadata: {
                city,
                applicationId: applicationId ? String(applicationId) : null,
                jobId: jobId ? String(jobId) : null,
            },
        });
    }
};

const markFirstHireOnce = async ({ employerId, applicationId = null, jobId = null, city = null }) => {
    const marked = await markMilestoneOnce({
        employerId,
        field: 'firstHireAt',
        city,
        extraSet: {
            ...(applicationId ? { firstHiredApplicationId: applicationId } : {}),
            ...(jobId ? { firstHiredJobId: jobId } : {}),
        },
    });

    if (marked) {
        await createAnalyticsEvent({
            userId: employerId,
            eventName: 'EMPLOYER_FIRST_HIRE',
            metadata: {
                city,
                applicationId: applicationId ? String(applicationId) : null,
                jobId: jobId ? String(jobId) : null,
            },
        });
    }
};

module.exports = {
    fireAndForget,
    markEmployerSignedUpOnce,
    markFirstJobDraftCreatedOnce,
    markFirstJobActivatedOnce,
    markFirstShortlistOnce,
    markFirstHireOnce,
    createAnalyticsEvent,
    recordLifecycleEvent,
    normalizeSalaryBand,
};
