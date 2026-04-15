const Application = require('../models/Application');
const HireFeedback = require('../models/HireFeedback');
const Job = require('../models/Job');
const SkillReputation = require('../models/SkillReputation');
const WorkerProfile = require('../models/WorkerProfile');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const clamp01 = (value) => clamp(value, 0, 1);

const tokenize = (value) => String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9+#]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

const normalizeSkill = (value) => String(value || '').trim().toLowerCase();

const buildSkillSetFromRoleProfiles = (roleProfiles = []) => {
    const set = new Set();
    for (const profile of roleProfiles) {
        const roleName = normalizeSkill(profile?.roleName);
        if (roleName) set.add(roleName);

        const skills = Array.isArray(profile?.skills) ? profile.skills : [];
        for (const skill of skills) {
            const normalized = normalizeSkill(skill);
            if (normalized) set.add(normalized);
        }
    }
    return set;
};

const extractJobSkills = (job = {}) => {
    const tokens = new Set();
    tokenize(job?.title || '').forEach((token) => tokens.add(token));
    (Array.isArray(job?.requirements) ? job.requirements : []).forEach((requirement) => {
        tokenize(requirement).forEach((token) => tokens.add(token));
    });
    return tokens;
};

const recomputeSkillReputationForUser = async ({ userId, skillsHint = [], reason = 'manual' }) => {
    if (!userId) return [];

    const workerProfile = await WorkerProfile.findOne({ user: userId })
        .select('_id roleProfiles')
        .lean();
    if (!workerProfile?._id) return [];

    const baseSkillSet = buildSkillSetFromRoleProfiles(workerProfile.roleProfiles || []);
    const hintedSkills = Array.isArray(skillsHint) ? skillsHint : [];
    hintedSkills.map(normalizeSkill).filter(Boolean).forEach((skill) => baseSkillSet.add(skill));

    const hiredApplications = await Application.find({
        worker: workerProfile._id,
        status: 'hired',
    })
        .select('_id job createdAt')
        .limit(200)
        .lean();

    const jobIds = Array.from(new Set(
        hiredApplications
            .map((row) => String(row.job || '').trim())
            .filter(Boolean)
    ));

    const jobs = jobIds.length
        ? await Job.find({ _id: { $in: jobIds } }).select('title requirements').lean()
        : [];
    const jobMap = new Map(jobs.map((row) => [String(row._id), row]));

    const feedbackRows = await HireFeedback.find({
        workerUserId: userId,
        'employerFeedback.skillAccuracy': { $exists: true },
    })
        .select('applicationId employerFeedback.skillAccuracy')
        .lean();
    const feedbackByApplicationId = new Map(
        feedbackRows.map((row) => [String(row.applicationId), Number(row?.employerFeedback?.skillAccuracy || 0)])
    );

    const signals = new Map();
    const ensureSignal = (skill) => {
        const normalized = normalizeSkill(skill);
        if (!normalized) return null;
        if (!signals.has(normalized)) {
            signals.set(normalized, {
                completedHires: 0,
                endorsements: 0,
            });
        }
        return signals.get(normalized);
    };

    baseSkillSet.forEach((skill) => ensureSignal(skill));

    for (const app of hiredApplications) {
        const job = jobMap.get(String(app.job));
        const jobSkills = extractJobSkills(job || {});
        const appRating = Number(feedbackByApplicationId.get(String(app._id)) || 0);

        for (const skill of jobSkills) {
            const row = ensureSignal(skill);
            if (!row) continue;
            row.completedHires += 1;
            if (appRating >= 4) {
                row.endorsements += 1;
            }
        }
    }

    const updates = [];
    for (const [skill, signal] of signals.entries()) {
        const completedHires = Number(signal.completedHires || 0);
        const endorsements = Number(signal.endorsements || 0);
        const repeatedContracts = Math.max(completedHires - 1, 0);

        const verifiedByHireCompletion = clamp01(completedHires / 6);
        const endorsedByEmployers = clamp01(endorsements / 6);
        const repeatedSuccessfulContracts = clamp01(repeatedContracts / 5);

        const score = clamp01(
            (verifiedByHireCompletion * 0.45)
            + (endorsedByEmployers * 0.35)
            + (repeatedSuccessfulContracts * 0.20)
        );

        updates.push(
            SkillReputation.findOneAndUpdate(
                { userId, skill },
                {
                    $set: {
                        userId,
                        skill,
                        score: Number(score.toFixed(4)),
                        verifiedByHireCompletion: Number(verifiedByHireCompletion.toFixed(4)),
                        endorsedByEmployers: Number(endorsedByEmployers.toFixed(4)),
                        repeatedSuccessfulContracts: Number(repeatedSuccessfulContracts.toFixed(4)),
                        signalCounts: {
                            completedHires,
                            endorsements,
                            repeatedContracts,
                        },
                        computedAt: new Date(),
                        metadata: {
                            reason,
                            computedAt: new Date().toISOString(),
                        },
                    },
                },
                { upsert: true, new: true }
            ).lean()
        );
    }

    const rows = await Promise.all(updates);
    return rows.filter(Boolean);
};

const getSkillReputationProfileForUser = async ({ userId, recomputeIfMissing = true }) => {
    if (!userId) {
        return {
            map: new Map(),
            averageScore: 0,
            topSkills: [],
        };
    }

    let rows = await SkillReputation.find({ userId })
        .sort({ score: -1 })
        .limit(200)
        .lean();

    if (!rows.length && recomputeIfMissing) {
        await recomputeSkillReputationForUser({ userId, reason: 'profile_bootstrap' });
        rows = await SkillReputation.find({ userId })
            .sort({ score: -1 })
            .limit(200)
            .lean();
    }

    const map = new Map(rows.map((row) => [normalizeSkill(row.skill), Number(row.score || 0)]));
    const averageScore = rows.length
        ? rows.reduce((sum, row) => sum + Number(row.score || 0), 0) / rows.length
        : 0;

    return {
        map,
        averageScore: Number(averageScore.toFixed(4)),
        topSkills: rows.slice(0, 10).map((row) => ({
            skill: row.skill,
            score: Number(row.score || 0),
        })),
    };
};

const computeSkillReputationBoostFromProfile = ({ skillProfile, job = null }) => {
    const map = skillProfile?.map instanceof Map ? skillProfile.map : new Map();
    const averageScore = Number(skillProfile?.averageScore || 0);

    const jobSkills = extractJobSkills(job || {});
    const matchedScores = [];
    for (const token of jobSkills) {
        if (map.has(token)) {
            matchedScores.push(Number(map.get(token) || 0));
        }
    }

    const score = matchedScores.length
        ? matchedScores.reduce((sum, row) => sum + row, 0) / matchedScores.length
        : averageScore;

    const reputationScore = clamp01(score);
    const boost = clamp(0.95 + (reputationScore * 0.12), 0.95, 1.08);

    return {
        reputationScore: Number(reputationScore.toFixed(4)),
        skillReputationMultiplier: Number(boost.toFixed(4)),
        matchedSkillCount: matchedScores.length,
    };
};

module.exports = {
    recomputeSkillReputationForUser,
    getSkillReputationProfileForUser,
    computeSkillReputationBoostFromProfile,
};
