const Application = require('../models/Application');
const CitySkillGraph = require('../models/CitySkillGraph');
const { startOfUtcDay } = require('../utils/timezone');

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

const normalizeSalaryBandFromMax = (maxSalary) => {
    const salary = Number(maxSalary || 0);
    if (salary <= 0) return 'unknown';
    if (salary < 12000) return 'low';
    if (salary < 22000) return 'mid';
    if (salary < 35000) return 'high';
    return 'premium';
};

const computeCitySkillGraph = async ({
    day = new Date(),
    lookbackDays = 90,
    city = null,
} = {}) => {
    const from = new Date(day.getTime() - (lookbackDays * 24 * 60 * 60 * 1000));
    const dayStart = startOfUtcDay(day);

    const cityMatch = city
        ? { 'jobDoc.location': new RegExp(`^${escapeRegex(city)}$`, 'i') }
        : {};

    const rows = await Application.aggregate([
        {
            $match: {
                status: 'hired',
                updatedAt: { $gte: from, $lte: day },
            },
        },
        {
            $lookup: {
                from: 'jobs',
                localField: 'job',
                foreignField: '_id',
                as: 'jobDoc',
            },
        },
        { $unwind: '$jobDoc' },
        {
            $lookup: {
                from: 'workerprofiles',
                localField: 'worker',
                foreignField: '_id',
                as: 'workerDoc',
            },
        },
        { $unwind: '$workerDoc' },
        { $match: cityMatch },
        {
            $project: {
                city: '$jobDoc.location',
                roleCluster: '$jobDoc.title',
                maxSalary: '$jobDoc.maxSalary',
                skills: {
                    $ifNull: [
                        {
                            $let: {
                                vars: {
                                    firstRole: { $arrayElemAt: ['$workerDoc.roleProfiles', 0] },
                                },
                                in: '$$firstRole.skills',
                            },
                        },
                        [],
                    ],
                },
            },
        },
        { $unwind: '$skills' },
        {
            $group: {
                _id: {
                    city: '$city',
                    roleCluster: '$roleCluster',
                    skill: { $toLower: '$skills' },
                    maxSalary: '$maxSalary',
                },
                coOccurrenceFrequency: { $sum: 1 },
            },
        },
    ]);

    if (!rows.length) return [];

    const totalsByCityRole = new Map();
    rows.forEach((row) => {
        const cityKey = normalizeText(row._id?.city);
        const roleKey = normalizeText(row._id?.roleCluster);
        const key = `${cityKey}::${roleKey}`;
        totalsByCityRole.set(key, (totalsByCityRole.get(key) || 0) + Number(row.coOccurrenceFrequency || 0));
    });

    const operations = rows.map((row) => {
        const cityValue = normalizeText(row._id?.city);
        const roleValue = normalizeText(row._id?.roleCluster, 'general');
        const salaryBand = normalizeSalaryBandFromMax(row._id?.maxSalary);
        const totalForRole = totalsByCityRole.get(`${cityValue}::${roleValue}`) || 1;
        const probability = clamp(Number(row.coOccurrenceFrequency || 0) / totalForRole, 0, 1);

        return {
            updateOne: {
                filter: {
                    city: cityValue,
                    skill: normalizeText(row._id?.skill),
                    roleCluster: roleValue,
                    salaryBand,
                    computedDay: dayStart,
                },
                update: {
                    $set: {
                        city: cityValue,
                        skill: normalizeText(row._id?.skill),
                        roleCluster: roleValue,
                        salaryBand,
                        coOccurrenceFrequency: Number(row.coOccurrenceFrequency || 0),
                        hireSuccessProbability: Number(probability.toFixed(4)),
                        computedDay: dayStart,
                        metadata: {
                            lookbackDays,
                        },
                    },
                },
                upsert: true,
            },
        };
    });

    if (operations.length) {
        await CitySkillGraph.bulkWrite(operations, { ordered: false });
    }

    return CitySkillGraph.find({ computedDay: dayStart })
        .sort({ city: 1, roleCluster: 1, coOccurrenceFrequency: -1 })
        .lean();
};

const getLatestCitySkillGraph = async ({ city = null, limit = 500 } = {}) => {
    const cityFilter = city ? { city: new RegExp(`^${escapeRegex(city)}$`, 'i') } : {};
    return CitySkillGraph.aggregate([
        { $match: cityFilter },
        { $sort: { city: 1, roleCluster: 1, skill: 1, computedDay: -1 } },
        {
            $group: {
                _id: {
                    city: '$city',
                    roleCluster: '$roleCluster',
                    skill: '$skill',
                    salaryBand: '$salaryBand',
                },
                doc: { $first: '$$ROOT' },
            },
        },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { coOccurrenceFrequency: -1, city: 1, roleCluster: 1 } },
        { $limit: Number(limit) || 500 },
    ]);
};

module.exports = {
    computeCitySkillGraph,
    getLatestCitySkillGraph,
};
