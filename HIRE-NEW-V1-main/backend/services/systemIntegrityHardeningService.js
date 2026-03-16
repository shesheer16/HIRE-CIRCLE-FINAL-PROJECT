const WorkerProfile = require('../models/WorkerProfile');
const Application = require('../models/Application');
const Job = require('../models/Job');
const logger = require('../utils/logger');
const { backfillStructuredLocations } = require('./locationBackfillService');

const ensureOneActiveRoleProfile = (profiles = []) => {
    const rows = Array.isArray(profiles) ? profiles.filter(Boolean) : [];
    if (!rows.length) return [];

    let activeIndex = rows.findIndex((entry) => Boolean(entry?.activeProfile));
    if (activeIndex < 0) activeIndex = 0;

    return rows.map((entry, index) => ({
        ...entry,
        activeProfile: index === activeIndex,
    }));
};

const dedupeRoleProfiles = (profiles = []) => {
    const seen = new Set();
    const deduped = [];

    for (const profile of Array.isArray(profiles) ? profiles : []) {
        if (!profile || typeof profile !== 'object') continue;
        const profileId = String(profile.profileId || '').trim();
        const key = profileId || [
            String(profile.roleName || '').trim().toLowerCase(),
            String(profile.experienceInRole || '').trim(),
            String(profile.expectedSalary || '').trim(),
        ].join('|');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(profile);
    }

    return ensureOneActiveRoleProfile(deduped);
};

const resolveFallbackJobStatus = (job = {}) => (job?.isOpen ? 'OPEN' : 'PAUSED');

const dedupeWorkerProfilesByUser = async () => {
    const duplicateBuckets = await WorkerProfile.aggregate([
        {
            $group: {
                _id: '$user',
                ids: { $push: '$_id' },
                count: { $sum: 1 },
            },
        },
        {
            $match: {
                count: { $gt: 1 },
            },
        },
    ]);

    if (!duplicateBuckets.length) return { duplicateUsers: 0, mergedProfiles: 0 };

    let mergedProfiles = 0;

    for (const bucket of duplicateBuckets) {
        const docs = await WorkerProfile.find({ _id: { $in: bucket.ids } })
            .sort({ updatedAt: -1, createdAt: -1 })
            .lean();
        if (!docs.length) continue;

        const primary = docs[0];
        const secondary = docs.slice(1);
        const now = new Date();

        const mergedRoleProfiles = dedupeRoleProfiles(
            docs.flatMap((doc) => (Array.isArray(doc.roleProfiles) ? doc.roleProfiles : []))
        );

        const mergedPatch = {
            firstName: primary.firstName || secondary.find((doc) => doc.firstName)?.firstName || '',
            lastName: primary.lastName || secondary.find((doc) => doc.lastName)?.lastName || '',
            city: primary.city || secondary.find((doc) => doc.city)?.city || '',
            avatar: primary.avatar || secondary.find((doc) => doc.avatar)?.avatar || null,
            country: primary.country || secondary.find((doc) => doc.country)?.country || 'IN',
            language: primary.language || secondary.find((doc) => doc.language)?.language || null,
            totalExperience: Number(primary.totalExperience || 0),
            preferredShift: primary.preferredShift || 'Flexible',
            licenses: Array.from(new Set(
                docs.flatMap((doc) => (Array.isArray(doc.licenses) ? doc.licenses : []))
            )),
            roleProfiles: mergedRoleProfiles,
            isAvailable: primary.isAvailable !== false,
            availabilityWindowDays: [0, 15, 30].includes(Number(primary.availabilityWindowDays))
                ? Number(primary.availabilityWindowDays)
                : 0,
            openToRelocation: Boolean(primary.openToRelocation),
            openToNightShift: Boolean(primary.openToNightShift),
            interviewVerified: Boolean(primary.interviewVerified),
            updated_at: now,
        };

        await WorkerProfile.updateOne(
            { _id: primary._id },
            { $set: mergedPatch }
        );

        const secondaryIds = secondary.map((doc) => doc._id);
        if (secondaryIds.length) {
            await WorkerProfile.deleteMany({ _id: { $in: secondaryIds } });
            mergedProfiles += secondaryIds.length;
        }
    }

    return {
        duplicateUsers: duplicateBuckets.length,
        mergedProfiles,
    };
};

const dedupeApplicationsByJobWorker = async () => {
    const duplicateBuckets = await Application.aggregate([
        {
            $group: {
                _id: {
                    job: '$job',
                    worker: '$worker',
                },
                ids: { $push: '$_id' },
                count: { $sum: 1 },
            },
        },
        {
            $match: {
                count: { $gt: 1 },
            },
        },
    ]);

    if (!duplicateBuckets.length) return { duplicatePairs: 0, mergedApplications: 0 };

    let mergedApplications = 0;
    for (const bucket of duplicateBuckets) {
        const docs = await Application.find({ _id: { $in: bucket.ids } })
            .sort({ updatedAt: -1, createdAt: -1 })
            .lean();
        if (docs.length <= 1) continue;
        const keep = docs[0];
        const removeIds = docs.slice(1).map((doc) => doc._id);
        await Application.updateOne(
            { _id: keep._id },
            { $set: { updated_at: new Date() } }
        );
        await Application.deleteMany({ _id: { $in: removeIds } });
        mergedApplications += removeIds.length;
    }

    return {
        duplicatePairs: duplicateBuckets.length,
        mergedApplications,
    };
};

const migrateLegacyJobStatuses = async () => {
    const now = new Date();
    const statusMap = {
        draft_from_ai: 'DRAFT',
        draft: 'DRAFT',
        active: 'OPEN',
        open: 'OPEN',
        paused: 'PAUSED',
        filled: 'FILLED',
        closed: 'CLOSED',
        archived: 'ARCHIVED',
        expired: 'EXPIRED',
    };

    let updated = 0;
    for (const [legacy, canonical] of Object.entries(statusMap)) {
        const result = await Job.updateMany(
            { status: legacy },
            {
                $set: {
                    status: canonical,
                    isOpen: canonical === 'OPEN',
                    updated_at: now,
                },
            }
        );
        updated += Number(result.modifiedCount || 0);
    }

    const unknownJobs = await Job.find({
        status: {
            $nin: Job.JOB_STATUS_ENUM,
        },
    }).select('_id status isOpen').lean();

    if (unknownJobs.length) {
        const bulk = unknownJobs.map((job) => ({
            updateOne: {
                filter: { _id: job._id },
                update: {
                    $set: {
                        status: Job.normalizeJobStatus(job.status, resolveFallbackJobStatus(job)),
                        isOpen: Job.normalizeJobStatus(job.status, resolveFallbackJobStatus(job)) === 'OPEN',
                        updated_at: now,
                    },
                },
            },
        }));
        const bulkResult = await Job.bulkWrite(bulk, { ordered: false });
        updated += Number(bulkResult.modifiedCount || 0);
    }

    return {
        updated,
        unknownMigrated: unknownJobs.length,
    };
};

const ensureIntegrityIndexes = async () => {
    const workerIndexes = await WorkerProfile.collection.indexes();
    const legacyWorkerUserIndexes = workerIndexes.filter((index) => (
        index?.name !== '_id_'
        && index?.unique !== true
        && index?.key
        && index.key.user === 1
    ));

    for (const index of legacyWorkerUserIndexes) {
        if (index?.name) {
            await WorkerProfile.collection.dropIndex(index.name);
        }
    }

    const hasUniqueWorkerUserIndex = workerIndexes.some((index) => (
        index?.name !== '_id_'
        && index?.unique === true
        && index?.key
        && index.key.user === 1
    ));
    if (!hasUniqueWorkerUserIndex) {
        await WorkerProfile.collection.createIndex({ user: 1 }, { unique: true, name: 'user_1_unique' });
    }

    const applicationIndexes = await Application.collection.indexes();
    const legacyApplicationIndexes = applicationIndexes.filter((index) => (
        index?.name !== '_id_'
        && index?.key
        && index.key.job === 1
        && index.key.worker === 1
        && index?.unique !== true
    ));

    for (const index of legacyApplicationIndexes) {
        if (index?.name) {
            await Application.collection.dropIndex(index.name);
        }
    }

    const hasUniqueApplicationIndex = applicationIndexes.some((index) => (
        index?.name !== '_id_'
        && index?.unique === true
        && index?.key
        && index.key.job === 1
        && index.key.worker === 1
    ));
    if (!hasUniqueApplicationIndex) {
        await Application.collection.createIndex({ job: 1, worker: 1 }, { unique: true, name: 'job_1_worker_1_unique' });
    }
};

const runSystemIntegrityHardening = async () => {
    try {
        const dedupeSummary = await dedupeWorkerProfilesByUser();
        const applicationDedupeSummary = await dedupeApplicationsByJobWorker();
        await ensureIntegrityIndexes();
        const migrated = await migrateLegacyJobStatuses();
        const locationBackfillSummary = await backfillStructuredLocations();

        logger.info({
            event: 'system_integrity_hardening_complete',
            dedupeSummary,
            applicationDedupeSummary,
            migrated,
            locationBackfillSummary,
        });

        return {
            ok: true,
            dedupeSummary,
            applicationDedupeSummary,
            migrated,
            locationBackfillSummary,
        };
    } catch (error) {
        logger.error({
            event: 'system_integrity_hardening_failed',
            message: error?.message || String(error),
        });
        throw error;
    }
};

module.exports = {
    runSystemIntegrityHardening,
};
