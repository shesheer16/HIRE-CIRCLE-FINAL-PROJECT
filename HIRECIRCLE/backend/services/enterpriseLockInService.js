const crypto = require('crypto');

const Application = require('../models/Application');
const { EnterpriseWorkspace, ENTERPRISE_TEAM_ROLES } = require('../models/EnterpriseWorkspace');
const Job = require('../models/Job');
const Organization = require('../models/Organization');
const User = require('../models/userModel');

const safeString = (value) => String(value || '').trim();

const buildIsolationKey = ({ ownerEmployerId, organizationId = null }) => {
    const source = `${safeString(ownerEmployerId)}:${safeString(organizationId) || 'solo'}:${Date.now()}`;
    return crypto.createHash('sha256').update(source).digest('hex').slice(0, 24);
};

const toRole = (value) => {
    const normalized = safeString(value).toLowerCase();
    return ENTERPRISE_TEAM_ROLES.includes(normalized) ? normalized : 'recruiter';
};

const findWorkspaceById = async (workspaceId) => EnterpriseWorkspace.findById(workspaceId);

const ensureEnterpriseWorkspace = async ({ ownerEmployerId, workspaceName = 'Enterprise Workspace' }) => {
    if (!ownerEmployerId) throw new Error('ownerEmployerId is required');

    const owner = await User.findById(ownerEmployerId)
        .select('_id organizationId subscription.plan')
        .lean();
    if (!owner) throw new Error('Owner user not found');

    const org = owner.organizationId
        ? await Organization.findById(owner.organizationId).select('subscriptionTier').lean()
        : null;

    const enterpriseVerified = (
        String(owner?.subscription?.plan || '').toLowerCase() === 'enterprise'
        || String(org?.subscriptionTier || '').toLowerCase() === 'enterprise'
    );

    let workspace = await EnterpriseWorkspace.findOne({ ownerEmployerId: owner._id });
    if (!workspace) {
        workspace = await EnterpriseWorkspace.create({
            ownerEmployerId: owner._id,
            organizationId: owner.organizationId || null,
            enterpriseVerified,
            workspaceName,
            dataIsolationKey: buildIsolationKey({
                ownerEmployerId: owner._id,
                organizationId: owner.organizationId,
            }),
            teamMembers: [{
                userId: owner._id,
                role: 'owner',
                active: true,
                invitedAt: new Date(),
            }],
        });
        return workspace;
    }

    workspace.workspaceName = workspaceName || workspace.workspaceName;
    workspace.enterpriseVerified = enterpriseVerified;
    workspace.organizationId = owner.organizationId || workspace.organizationId || null;

    const hasOwnerMember = (workspace.teamMembers || []).some(
        (row) => String(row.userId) === String(owner._id) && row.role === 'owner'
    );

    if (!hasOwnerMember) {
        workspace.teamMembers = [
            ...(workspace.teamMembers || []),
            {
                userId: owner._id,
                role: 'owner',
                active: true,
                invitedAt: new Date(),
            },
        ];
    }

    await workspace.save();
    return workspace;
};

const assertWorkspaceAccess = ({ workspace, userId, requiredRoles = [] }) => {
    if (!workspace) {
        const error = new Error('Workspace not found');
        error.statusCode = 404;
        throw error;
    }

    const callerId = String(userId || '');
    if (!callerId) {
        const error = new Error('Authentication required');
        error.statusCode = 401;
        throw error;
    }

    const ownerMatch = String(workspace.ownerEmployerId) === callerId;
    const teamMember = (workspace.teamMembers || []).find((row) => String(row.userId) === callerId && row.active !== false);
    if (!ownerMatch && !teamMember) {
        const error = new Error('No access to workspace');
        error.statusCode = 403;
        throw error;
    }

    const role = ownerMatch ? 'owner' : teamMember.role;
    if (requiredRoles.length && !requiredRoles.includes(role)) {
        const error = new Error('Insufficient workspace role');
        error.statusCode = 403;
        throw error;
    }

    return {
        role,
        teamMember: teamMember || null,
    };
};

const normalizeJobImportPayload = (job = {}) => {
    const title = safeString(job.title);
    const location = safeString(job.location);
    const companyName = safeString(job.companyName);
    const salaryRange = safeString(job.salaryRange || `${Number(job.minSalary || 0)} - ${Number(job.maxSalary || 0)}`);

    if (!title || !location || !companyName || !salaryRange) {
        return null;
    }

    return {
        title,
        location,
        companyName,
        salaryRange,
        requirements: Array.isArray(job.requirements) ? job.requirements : [],
        screeningQuestions: Array.isArray(job.screeningQuestions) ? job.screeningQuestions : [],
        minSalary: Number(job.minSalary || 0) || undefined,
        maxSalary: Number(job.maxSalary || 0) || undefined,
        shift: ['Day', 'Night', 'Flexible'].includes(String(job.shift)) ? String(job.shift) : 'Flexible',
        mandatoryLicenses: Array.isArray(job.mandatoryLicenses) ? job.mandatoryLicenses : [],
        status: 'active',
        isOpen: true,
    };
};

const bulkImportJobs = async ({ workspaceId, actorUserId, jobs = [] }) => {
    const workspace = await findWorkspaceById(workspaceId);
    assertWorkspaceAccess({
        workspace,
        userId: actorUserId,
        requiredRoles: ['owner', 'admin', 'recruiter'],
    });

    const normalizedJobs = (Array.isArray(jobs) ? jobs : [])
        .map(normalizeJobImportPayload)
        .filter(Boolean)
        .slice(0, 200);

    if (!normalizedJobs.length) {
        const error = new Error('No valid jobs to import');
        error.statusCode = 400;
        throw error;
    }

    const created = await Job.insertMany(
        normalizedJobs.map((job) => ({
            ...job,
            employerId: workspace.ownerEmployerId,
            enterpriseWorkspaceId: workspace._id,
            enterpriseIsolationKey: workspace.dataIsolationKey,
            metadata: {
                importedViaBulk: true,
                importedBy: actorUserId,
            },
        })),
        { ordered: false }
    );

    return {
        workspaceId: String(workspace._id),
        importedCount: created.length,
    };
};

const upsertTeamMember = async ({ workspaceId, actorUserId, memberUserId, role = 'recruiter' }) => {
    const workspace = await findWorkspaceById(workspaceId);
    assertWorkspaceAccess({
        workspace,
        userId: actorUserId,
        requiredRoles: ['owner', 'admin'],
    });

    const member = await User.findById(memberUserId).select('_id organizationId').lean();
    if (!member) {
        const error = new Error('Member user not found');
        error.statusCode = 404;
        throw error;
    }

    if (
        workspace.organizationId
        && member.organizationId
        && String(workspace.organizationId) !== String(member.organizationId)
    ) {
        const error = new Error('Team member must belong to same organization');
        error.statusCode = 400;
        throw error;
    }

    const resolvedRole = toRole(role);
    const existingIndex = (workspace.teamMembers || []).findIndex((row) => String(row.userId) === String(member._id));

    if (existingIndex >= 0) {
        workspace.teamMembers[existingIndex].role = resolvedRole;
        workspace.teamMembers[existingIndex].active = true;
    } else {
        workspace.teamMembers.push({
            userId: member._id,
            role: resolvedRole,
            active: true,
            invitedAt: new Date(),
        });
    }

    await workspace.save();
    return workspace;
};

const getRecruiterCollaborationSnapshot = async ({ workspaceId, userId }) => {
    const workspace = await findWorkspaceById(workspaceId).lean();
    assertWorkspaceAccess({
        workspace,
        userId,
        requiredRoles: ['owner', 'admin', 'recruiter', 'analyst', 'coordinator'],
    });

    const [recentJobs, recentApplications] = await Promise.all([
        Job.find({ enterpriseWorkspaceId: workspace._id })
            .sort({ createdAt: -1 })
            .limit(30)
            .select('_id title status createdAt employerId')
            .lean(),
        Application.find({ employer: workspace.ownerEmployerId })
            .sort({ updatedAt: -1 })
            .limit(60)
            .select('_id job worker status updatedAt employer')
            .lean(),
    ]);

    return {
        workspaceId: String(workspace._id),
        enterpriseVerified: Boolean(workspace.enterpriseVerified),
        teamMembers: (workspace.teamMembers || []).map((row) => ({
            userId: row.userId,
            role: row.role,
            active: row.active,
            invitedAt: row.invitedAt,
        })),
        jobs: recentJobs,
        applications: recentApplications,
    };
};

const getWorkspaceHiringAnalytics = async ({ workspaceId, userId, days = 90 }) => {
    const workspace = await findWorkspaceById(workspaceId).lean();
    assertWorkspaceAccess({
        workspace,
        userId,
        requiredRoles: ['owner', 'admin', 'analyst', 'recruiter'],
    });

    const since = new Date(Date.now() - (Math.max(7, Math.min(365, Number(days || 90))) * 24 * 60 * 60 * 1000));

    const jobs = await Job.find({
        enterpriseWorkspaceId: workspace._id,
        createdAt: { $gte: since },
    })
        .select('_id title createdAt isOpen')
        .lean();

    const jobIds = jobs.map((row) => row._id);
    const applications = jobIds.length
        ? await Application.find({
            job: { $in: jobIds },
            createdAt: { $gte: since },
        })
            .select('_id status job createdAt updatedAt')
            .lean()
        : [];

    const hires = applications.filter((row) => row.status === 'hired');
    const fillRate = applications.length > 0 ? (hires.length / applications.length) : 0;

    return {
        workspaceId: String(workspace._id),
        days: Number(days || 90),
        jobsPosted: jobs.length,
        applications: applications.length,
        hires: hires.length,
        fillRate: Number(fillRate.toFixed(4)),
        analyticsAccessEnabled: Boolean(workspace?.featureAccess?.hiringAnalyticsAccess),
    };
};

const getSlaPriorityRouting = async ({ workspaceId, userId }) => {
    const workspace = await findWorkspaceById(workspaceId).lean();
    assertWorkspaceAccess({
        workspace,
        userId,
        requiredRoles: ['owner', 'admin', 'coordinator', 'recruiter'],
    });

    const routingEnabled = Boolean(workspace?.featureAccess?.slaPriorityRouting);
    const queuePriority = workspace.enterpriseVerified ? 'P1' : 'P2';

    return {
        workspaceId: String(workspace._id),
        routingEnabled,
        queuePriority,
        targetFirstResponseMinutes: workspace.enterpriseVerified ? 30 : 120,
        targetFillTimeHours: workspace.enterpriseVerified ? 48 : 96,
    };
};

module.exports = {
    ensureEnterpriseWorkspace,
    bulkImportJobs,
    upsertTeamMember,
    getRecruiterCollaborationSnapshot,
    getWorkspaceHiringAnalytics,
    getSlaPriorityRouting,
};
