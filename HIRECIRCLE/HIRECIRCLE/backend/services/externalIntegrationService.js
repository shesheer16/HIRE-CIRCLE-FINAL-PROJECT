const BackgroundJob = require('../models/BackgroundJob');
const { Integration } = require('../models/Integration');
const Job = require('../models/Job');
const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');

const INTEGRATION_QUEUE = 'external_integrations';
const INTEGRATION_JOB_TYPE = 'external_integration_sync';

const queueIntegrationSyncJob = async ({ integrationId, ownerId, trigger = 'manual' } = {}) => {
    if (!integrationId || !ownerId) {
        throw new Error('integrationId and ownerId are required');
    }

    const job = await BackgroundJob.create({
        queue: INTEGRATION_QUEUE,
        type: INTEGRATION_JOB_TYPE,
        payload: {
            integrationId,
            ownerId,
            trigger,
        },
        status: 'queued',
        attempts: 0,
        maxAttempts: Number.parseInt(process.env.EXTERNAL_INTEGRATION_MAX_ATTEMPTS || '3', 10),
        runAt: new Date(),
    });

    return job;
};

const performGenericAtsSync = async ({ ownerId }) => {
    const [jobs, applications] = await Promise.all([
        Job.countDocuments({ employerId: ownerId }),
        Application.countDocuments({ employer: ownerId }),
    ]);

    return {
        connector: 'generic_ats_sync',
        exportedJobs: jobs,
        exportedApplications: applications,
    };
};

const performGenericHrisPush = async ({ ownerId }) => {
    const applications = await Application.find({
        employer: ownerId,
        status: {
            $in: [
                'offer_accepted',
                'hired',
                // Legacy compatibility.
                'accepted',
            ],
        },
    })
        .select('worker')
        .lean();

    const workerIds = Array.from(new Set(applications.map((item) => String(item.worker || '')).filter(Boolean)));
    const profiles = await WorkerProfile.countDocuments({ _id: { $in: workerIds } });

    return {
        connector: 'generic_hris_push',
        pushedCandidateProfiles: profiles,
    };
};

const performGenericCrmSync = async ({ ownerId }) => {
    const totalCandidates = await Application.countDocuments({ employer: ownerId });
    return {
        connector: 'generic_crm_sync',
        syncedCandidateRecords: totalCandidates,
    };
};

const processIntegrationSyncJob = async (job) => {
    const integrationId = job?.payload?.integrationId;
    const ownerId = job?.payload?.ownerId;

    if (!integrationId || !ownerId) {
        return { retry: false };
    }

    const integration = await Integration.findOne({ _id: integrationId, ownerId });
    if (!integration) {
        return { retry: false };
    }

    if (integration.status === 'paused') {
        return { retry: false };
    }

    try {
        let syncSummary = null;

        if (integration.connector === 'generic_ats_sync') {
            syncSummary = await performGenericAtsSync({ ownerId });
        } else if (integration.connector === 'generic_hris_push') {
            syncSummary = await performGenericHrisPush({ ownerId });
        } else {
            syncSummary = await performGenericCrmSync({ ownerId });
        }

        integration.lastSync = new Date();
        integration.syncError = null;
        integration.status = 'active';
        integration.config = {
            ...(integration.config || {}),
            lastSyncSummary: syncSummary,
        };
        await integration.save();

        return { retry: false, summary: syncSummary };
    } catch (error) {
        integration.syncError = String(error.message || 'Integration sync failed').slice(0, 500);
        integration.status = 'error';
        await integration.save();

        const attempt = Number(job.attempts || 1);
        const shouldRetry = attempt < Number(job.maxAttempts || 3);

        if (!shouldRetry) {
            return {
                retry: false,
                reason: integration.syncError,
            };
        }

        const retryDelayMs = Math.min(15 * 60 * 1000, 1000 * (2 ** attempt));

        return {
            retry: true,
            runAt: new Date(Date.now() + retryDelayMs),
            reason: integration.syncError,
        };
    }
};

module.exports = {
    INTEGRATION_QUEUE,
    INTEGRATION_JOB_TYPE,
    queueIntegrationSyncJob,
    processIntegrationSyncJob,
};
