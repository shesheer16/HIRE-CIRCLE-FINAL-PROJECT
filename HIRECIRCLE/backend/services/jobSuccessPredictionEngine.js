const Application = require('../models/Application');
const Job = require('../models/Job');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const clamp01 = (value) => clamp(value, 0, 1);
const safeDiv = (num, den) => (Number(den) > 0 ? Number(num || 0) / Number(den) : 0);
const normalizeText = (value, fallback = 'unknown') => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || fallback;
};
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveJob = async ({ jobId = null, jobData = null } = {}) => {
    if (jobData && typeof jobData === 'object') return jobData;
    if (!jobId) return null;

    return Job.findById(jobId)
        .select('_id title location salaryRange minSalary maxSalary requirements screeningQuestions companyName')
        .lean();
};

const resolveSalaryMedian = async ({ city, role }) => {
    const cityRegex = new RegExp(`^${escapeRegex(normalizeText(city, 'unknown'))}$`, 'i');
    const roleRegex = new RegExp(escapeRegex(normalizeText(role, 'general')), 'i');

    const rows = await Job.find({
        location: cityRegex,
        title: roleRegex,
    })
        .select('minSalary maxSalary')
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();

    const values = rows
        .map((row) => {
            const min = Number(row.minSalary || 0);
            const max = Number(row.maxSalary || 0);
            if (min > 0 && max > 0) return (min + max) / 2;
            if (max > 0) return max;
            if (min > 0) return min;
            return null;
        })
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);

    if (!values.length) return null;

    const mid = Math.floor(values.length / 2);
    if (values.length % 2 === 0) return (values[mid - 1] + values[mid]) / 2;
    return values[mid];
};

const resolveHistoricalAttraction = async ({ city, role }) => {
    const cityRegex = new RegExp(`^${escapeRegex(normalizeText(city, 'unknown'))}$`, 'i');
    const roleRegex = new RegExp(escapeRegex(normalizeText(role, 'general')), 'i');

    const rows = await Job.aggregate([
        {
            $match: {
                location: cityRegex,
                title: roleRegex,
            },
        },
        {
            $lookup: {
                from: 'applications',
                localField: '_id',
                foreignField: 'job',
                as: 'apps',
            },
        },
        {
            $project: {
                appCount: { $size: { $ifNull: ['$apps', []] } },
            },
        },
        {
            $group: {
                _id: null,
                avgApplicants: { $avg: '$appCount' },
                sampleSize: { $sum: 1 },
            },
        },
    ]);

    return {
        avgApplicants: Number(rows[0]?.avgApplicants || 0),
        sampleSize: Number(rows[0]?.sampleSize || 0),
    };
};

const predictJobSuccess = async ({ jobId = null, jobData = null } = {}) => {
    const job = await resolveJob({ jobId, jobData });
    if (!job) {
        throw new Error('Job not found for success prediction');
    }

    const city = normalizeText(job.location, 'unknown');
    const role = normalizeText(job.title, 'general');
    const requirementCount = Array.isArray(job.requirements) ? job.requirements.length : 0;
    const screeningCount = Array.isArray(job.screeningQuestions) ? job.screeningQuestions.length : 0;
    const hasDescription = String(job.companyName || '').trim().length > 0;

    const salaryValue = Number(job.maxSalary || 0) > 0
        ? Number(job.maxSalary)
        : Number(job.minSalary || 0);

    const [medianSalary, historicalAttraction] = await Promise.all([
        resolveSalaryMedian({ city, role }),
        resolveHistoricalAttraction({ city, role }),
    ]);

    const salaryCompetitiveness = medianSalary && salaryValue > 0
        ? clamp01(safeDiv(salaryValue, Math.max(medianSalary, 1)))
        : 0.5;

    const skillClarityScore = clamp01(safeDiv(requirementCount, 8));
    const descriptionCompletenessScore = clamp01(
        (Number(hasDescription) * 0.5)
        + (clamp01(safeDiv(screeningCount, 4)) * 0.5)
    );

    const historicalSignal = clamp01(safeDiv(historicalAttraction.avgApplicants, 10));

    const applicantProbability = clamp01(
        (salaryCompetitiveness * 0.35)
        + (skillClarityScore * 0.25)
        + (descriptionCompletenessScore * 0.2)
        + (historicalSignal * 0.2)
    );

    const ignoredProbability = clamp01(1 - applicantProbability);

    const overpricedScore = medianSalary && salaryValue > 0
        ? clamp01(safeDiv(salaryValue - medianSalary, Math.max(medianSalary, 1)))
        : 0;
    const underspecifiedScore = clamp01(
        1 - ((skillClarityScore * 0.6) + (descriptionCompletenessScore * 0.4))
    );

    const overpriced = overpricedScore >= 0.35;
    const underspecified = underspecifiedScore >= 0.45;

    const suggestions = [];
    if (medianSalary && salaryValue > 0 && salaryCompetitiveness < 0.75) {
        suggestions.push('salary_suggestion: consider aligning salary closer to local role median for faster response.');
    }
    if (underspecified) {
        suggestions.push('skill_clarity_suggestion: add 3-5 concrete requirements tied to daily tasks.');
        suggestions.push('description_enhancement_prompt: include shift, growth path, and exact responsibilities.');
    }
    if (overpriced) {
        suggestions.push('pricing_sanity_check: verify compensation band and mention why premium pay is justified.');
    }

    return {
        jobId: job._id || null,
        city,
        role,
        predictedOutcomes: {
            likelyGetApplicants: applicantProbability >= 0.6,
            likelyIgnored: ignoredProbability >= 0.6,
            potentiallyOverpriced: overpriced,
            potentiallyUnderspecified: underspecified,
        },
        scores: {
            applicantProbability: Number(applicantProbability.toFixed(4)),
            ignoredProbability: Number(ignoredProbability.toFixed(4)),
            overpricedScore: Number(overpricedScore.toFixed(4)),
            underspecifiedScore: Number(underspecifiedScore.toFixed(4)),
        },
        suggestions,
        explainability: {
            salaryCompetitiveness: Number(salaryCompetitiveness.toFixed(4)),
            skillClarityScore: Number(skillClarityScore.toFixed(4)),
            descriptionCompletenessScore: Number(descriptionCompletenessScore.toFixed(4)),
            historicalSignal: Number(historicalSignal.toFixed(4)),
            marketMedianSalary: medianSalary ? Number(medianSalary.toFixed(2)) : null,
            historicalSampleSize: Number(historicalAttraction.sampleSize || 0),
            model: 'job_success_weighted_v1',
        },
    };
};

module.exports = {
    predictJobSuccess,
};
