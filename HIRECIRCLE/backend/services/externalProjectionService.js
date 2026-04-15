const crypto = require('crypto');
const { resolvePagination } = require('../utils/pagination');

const normalizeString = (value = '') => String(value || '').trim();

const toPublicId = (entity = 'entity', rawId = '') => {
    const id = normalizeString(rawId);
    if (!id) return null;
    const salt = String(process.env.EXTERNAL_PUBLIC_ID_SALT || 'hire-external-public-id-salt');
    const digest = crypto.createHmac('sha256', salt).update(`${entity}:${id}`).digest('hex');
    return `${entity}_${digest.slice(0, 24)}`;
};

const parseRequestedFields = (input = '') => (
    String(input || '')
        .split(',')
        .map((part) => normalizeString(part))
        .filter(Boolean)
);

const pickAllowedFields = (row = {}, allowedFields = [], requestedFields = []) => {
    const whitelist = new Set(Array.isArray(allowedFields) ? allowedFields : []);
    const requested = Array.isArray(requestedFields) && requestedFields.length
        ? requestedFields.filter((field) => whitelist.has(field))
        : allowedFields;

    return requested.reduce((acc, field) => {
        if (Object.prototype.hasOwnProperty.call(row, field)) {
            acc[field] = row[field];
        }
        return acc;
    }, {});
};

const toExternalJobs = (jobs = [], requestedFields = []) => {
    const allowedFields = [
        'externalId',
        'title',
        'companyName',
        'location',
        'salaryRange',
        'status',
        'isOpen',
        'requirements',
        'createdAt',
        'updatedAt',
    ];

    return jobs.map((job) => pickAllowedFields({
        externalId: toPublicId('job', job._id),
        title: job.title,
        companyName: job.companyName,
        location: job.location,
        salaryRange: job.salaryRange,
        status: job.status,
        isOpen: Boolean(job.isOpen),
        requirements: Array.isArray(job.requirements) ? job.requirements.slice(0, 30) : [],
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
    }, allowedFields, requestedFields));
};

const toExternalApplications = (applications = [], requestedFields = []) => {
    const allowedFields = [
        'externalId',
        'jobExternalId',
        'candidateExternalId',
        'status',
        'initiatedBy',
        'lastMessage',
        'createdAt',
        'updatedAt',
    ];

    return applications.map((row) => pickAllowedFields({
        externalId: toPublicId('application', row._id),
        jobExternalId: toPublicId('job', row.job),
        candidateExternalId: toPublicId('candidate', row.worker),
        status: row.status,
        initiatedBy: row.initiatedBy,
        lastMessage: row.lastMessage,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }, allowedFields, requestedFields));
};

const toExternalCandidates = (candidates = [], requestedFields = []) => {
    const allowedFields = [
        'externalId',
        'firstName',
        'city',
        'totalExperience',
        'preferredShift',
        'isAvailable',
        'reliabilityScore',
        'roleProfiles',
        'createdAt',
        'updatedAt',
    ];

    return candidates.map((candidate) => pickAllowedFields({
        externalId: toPublicId('candidate', candidate._id),
        firstName: candidate.firstName,
        city: candidate.city,
        totalExperience: Number(candidate.totalExperience || 0),
        preferredShift: candidate.preferredShift,
        isAvailable: Boolean(candidate.isAvailable),
        reliabilityScore: Number(candidate.reliabilityScore || 0),
        roleProfiles: Array.isArray(candidate.roleProfiles)
            ? candidate.roleProfiles.slice(0, 5).map((role) => ({
                roleName: role.roleName,
                experienceInRole: role.experienceInRole,
                expectedSalary: role.expectedSalary,
                skills: Array.isArray(role.skills) ? role.skills.slice(0, 20) : [],
            }))
            : [],
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
    }, allowedFields, requestedFields));
};

const toExternalMatches = (matches = [], requestedFields = []) => {
    const allowedFields = [
        'externalId',
        'jobExternalId',
        'candidateExternalId',
        'finalScore',
        'tier',
        'accepted',
        'matchModelVersionUsed',
        'createdAt',
        'updatedAt',
    ];

    return matches.map((match) => pickAllowedFields({
        externalId: toPublicId('match', match._id),
        jobExternalId: toPublicId('job', match.jobId),
        candidateExternalId: toPublicId('candidate', match.workerId),
        finalScore: Number(match.finalScore || 0),
        tier: match.tier,
        accepted: Boolean(match.accepted),
        matchModelVersionUsed: match.matchModelVersionUsed || null,
        createdAt: match.createdAt,
        updatedAt: match.updatedAt,
    }, allowedFields, requestedFields));
};

const buildPaginationMeta = ({ total, page, limit }) => ({
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
});

const resolveExternalPagination = (reqQuery = {}) => {
    const { page, limit } = resolvePagination({
        page: reqQuery.page,
        limit: reqQuery.limit,
        defaultLimit: 25,
        maxLimit: 100,
    });

    return {
        page,
        limit,
        skip: (page - 1) * limit,
    };
};

module.exports = {
    toPublicId,
    parseRequestedFields,
    pickAllowedFields,
    toExternalJobs,
    toExternalApplications,
    toExternalCandidates,
    toExternalMatches,
    resolveExternalPagination,
    buildPaginationMeta,
};
