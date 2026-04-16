const CityLiquidityScore = require('../models/CityLiquidityScore');
const CitySkillGraph = require('../models/CitySkillGraph');
const EmployerTier = require('../models/EmployerTier');
const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const normalizeText = (value, fallback = 'unknown') => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || fallback;
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cityRegex = (city) => new RegExp(`^${escapeRegex(city)}$`, 'i');

const detectSalaryBand = (job = {}) => {
    const maxSalary = Number(job.maxSalary || 0);
    if (maxSalary > 0) {
        if (maxSalary < 12000) return 'low';
        if (maxSalary < 22000) return 'mid';
        if (maxSalary < 35000) return 'high';
        return 'premium';
    }

    const text = String(job.salaryRange || '').toLowerCase();
    if (text.includes('10k') || text.includes('12k')) return 'low';
    if (text.includes('20k') || text.includes('22k')) return 'mid';
    if (text.includes('35k') || text.includes('40k')) return 'high';
    return 'unknown';
};

const resolveEmployerFactor = (tier = 'Standard') => {
    if (tier === 'Platinum') return 0.85;
    if (tier === 'Gold') return 0.92;
    if (tier === 'Silver') return 0.98;
    return 1.06;
};

const resolveSalaryFactor = (salaryBand = 'unknown') => {
    if (salaryBand === 'premium') return 0.82;
    if (salaryBand === 'high') return 0.9;
    if (salaryBand === 'mid') return 1;
    if (salaryBand === 'low') return 1.16;
    return 1.04;
};

const resolveSkillScarcityIndex = async ({ city, roleCluster, salaryBand }) => {
    const cityValue = normalizeText(city, '');
    const roleValue = normalizeText(roleCluster, '');

    if (!cityValue || !roleValue) {
        return {
            skillScarcityIndex: 0.5,
            workersForRole: 0,
            jobsForRole: 0,
            source: 'fallback',
        };
    }

    const [graphSignal, workersForRole, jobsForRole] = await Promise.all([
        CitySkillGraph.findOne({
            city: cityRegex(cityValue),
            roleCluster: new RegExp(`^${escapeRegex(roleValue)}$`, 'i'),
            salaryBand,
        })
            .sort({ computedDay: -1 })
            .select('hireSuccessProbability')
            .lean(),
        WorkerProfile.countDocuments({
            city: cityRegex(cityValue),
            'roleProfiles.roleName': new RegExp(escapeRegex(roleValue), 'i'),
            isAvailable: true,
        }),
        Job.countDocuments({
            location: cityRegex(cityValue),
            title: new RegExp(escapeRegex(roleValue), 'i'),
            isOpen: true,
            status: 'active',
        }),
    ]);

    if (graphSignal) {
        return {
            skillScarcityIndex: Number(clamp(1 - Number(graphSignal.hireSuccessProbability || 0), 0, 1).toFixed(4)),
            workersForRole,
            jobsForRole,
            source: 'city_skill_graph',
        };
    }

    const workersPerJob = Number(workersForRole) / Math.max(Number(jobsForRole), 1);
    const scarcity = clamp(1 - Math.min(workersPerJob / 5, 1), 0, 1);

    return {
        skillScarcityIndex: Number(scarcity.toFixed(4)),
        workersForRole,
        jobsForRole,
        source: 'supply_ratio_fallback',
    };
};

const resolveJob = async ({ jobId = null, jobData = null }) => {
    if (jobData && typeof jobData === 'object') {
        return {
            ...jobData,
            _id: jobData._id || null,
        };
    }

    if (jobId) {
        return Job.findById(jobId)
            .select('_id title location maxSalary salaryRange employerId')
            .lean();
    }

    return null;
};

const predictTimeToFill = async ({ jobId = null, jobData = null }) => {
    const job = await resolveJob({ jobId, jobData });
    if (!job) {
        throw new Error('Job not found for fill prediction');
    }

    const roleCluster = normalizeText(job.title, 'general');
    const salaryBand = detectSalaryBand(job);
    const city = normalizeText(job.location, 'unknown');

    const [liquidity, employerTier, scarcity] = await Promise.all([
        CityLiquidityScore.findOne({ city: cityRegex(city) })
            .sort({ day: -1 })
            .select('workersPerJob avgTimeToFill fillRate activeWorkers30d openJobs')
            .lean(),
        EmployerTier.findOne({ employerId: job.employerId })
            .select('tier')
            .lean(),
        resolveSkillScarcityIndex({ city, roleCluster, salaryBand }),
    ]);

    const baseDays = clamp(Number(liquidity?.avgTimeToFill || 10), 2, 45);
    const skillScarcityIndex = Number(clamp(scarcity.skillScarcityIndex || 0.5, 0, 1).toFixed(4));
    const scarcityFactor = clamp(0.85 + (skillScarcityIndex * 0.7), 0.85, 1.55);
    const salaryFactor = resolveSalaryFactor(salaryBand);
    const employerFactor = resolveEmployerFactor(employerTier?.tier || 'Standard');

    const expectedDays = clamp(baseDays * scarcityFactor * salaryFactor * employerFactor, 1, 120);

    const completenessSignals = [
        Number(Boolean(liquidity)),
        Number(Boolean(employerTier)),
        Number(Boolean(job.maxSalary || job.salaryRange)),
        Number(Boolean(roleCluster && roleCluster !== 'general')),
    ];
    const completeness = completenessSignals.reduce((sum, value) => sum + value, 0) / completenessSignals.length;
    const confidence = clamp(0.45 + (completeness * 0.5), 0.45, 0.95);
    const spread = Math.max(1, expectedDays * (1 - confidence) * 0.9);

    return {
        jobId: job._id || null,
        city,
        roleCluster,
        salaryBand,
        expectedDaysToFill: Number(expectedDays.toFixed(2)),
        confidenceRange: {
            lowDays: Number(clamp(expectedDays - spread, 1, 120).toFixed(2)),
            highDays: Number(clamp(expectedDays + spread, 1, 120).toFixed(2)),
            confidenceScore: Number(confidence.toFixed(4)),
        },
        explainability: {
            baseDays: Number(baseDays.toFixed(2)),
            factors: {
                scarcityFactor: Number(scarcityFactor.toFixed(4)),
                salaryFactor: Number(salaryFactor.toFixed(4)),
                employerFactor: Number(employerFactor.toFixed(4)),
            },
            cityLiquidity: liquidity
                ? {
                    workersPerJob: Number(liquidity.workersPerJob || 0),
                    fillRate: Number(liquidity.fillRate || 0),
                }
                : null,
            employerTier: employerTier?.tier || 'Standard',
            skillScarcity: {
                index: skillScarcityIndex,
                workersForRole: Number(scarcity.workersForRole || 0),
                jobsForRole: Number(scarcity.jobsForRole || 0),
                source: scarcity.source,
            },
        },
    };
};

module.exports = {
    predictTimeToFill,
    detectSalaryBand,
};
