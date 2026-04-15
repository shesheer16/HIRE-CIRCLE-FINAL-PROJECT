const AgentExecutionLog = require('../models/AgentExecutionLog');
const { appendPlatformAuditLog } = require('./platformAuditService');

const truncate = (value = '', max = 280) => String(value || '').slice(0, max);

const sanitizeInputPreview = (payload = {}) => {
    const clone = { ...(payload || {}) };
    if (!clone.allowPii) {
        delete clone.pii;
    }
    return clone;
};

const runJobDescriptionOptimization = ({ input = {} }) => {
    const text = String(input.jobDescription || '').trim();
    const improved = text
        ? `${text}\n\nHighlights:\n- Clarify shift details\n- Add salary transparency\n- Specify measurable outcomes`
        : 'Provide a complete job description with responsibilities, outcomes, and must-have skills.';

    return {
        optimizedDescription: improved,
        recommendations: [
            'Use action-oriented role summary in first 2 lines.',
            'State salary band and work arrangement explicitly.',
            'Add 3-5 essential skills and success metrics.',
        ],
    };
};

const runCandidateScreening = ({ input = {} }) => {
    const candidates = Array.isArray(input.candidates) ? input.candidates : [];
    const screened = candidates
        .map((candidate) => {
            const skills = Array.isArray(candidate.skills) ? candidate.skills.length : 0;
            const experience = Number(candidate.experience || 0);
            const score = Number((Math.min(100, (skills * 8) + (experience * 6))).toFixed(1));
            return {
                candidateId: candidate.candidateId || null,
                score,
                recommendation: score >= 70 ? 'shortlist' : score >= 45 ? 'review' : 'reject',
            };
        })
        .sort((a, b) => b.score - a.score);

    return {
        screened,
        total: screened.length,
    };
};

const runSalaryBenchmarking = ({ input = {} }) => {
    const market = Array.isArray(input.marketSamples) ? input.marketSamples : [];
    const salaries = market
        .map((sample) => Number(sample.salary || 0))
        .filter((salary) => Number.isFinite(salary) && salary > 0)
        .sort((a, b) => a - b);

    if (!salaries.length) {
        return {
            suggestedRange: { min: 0, median: 0, max: 0 },
            confidence: 'low',
        };
    }

    const min = salaries[0];
    const max = salaries[salaries.length - 1];
    const median = salaries[Math.floor(salaries.length / 2)];

    return {
        suggestedRange: { min, median, max },
        confidence: salaries.length >= 10 ? 'high' : 'medium',
    };
};

const runTalentPoolAnalysis = ({ input = {} }) => {
    const candidates = Array.isArray(input.candidates) ? input.candidates : [];
    const cityCounts = candidates.reduce((acc, candidate) => {
        const city = String(candidate.city || 'unknown').trim().toLowerCase();
        acc[city] = (acc[city] || 0) + 1;
        return acc;
    }, {});

    const strongestCity = Object.entries(cityCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

    return {
        poolSize: candidates.length,
        strongestCity,
        cityDistribution: cityCounts,
    };
};

const runInterviewQuestionGeneration = ({ input = {} }) => {
    const role = String(input.role || 'general role').trim();
    const skills = Array.isArray(input.skills) ? input.skills : [];

    const questions = [
        `Describe a recent challenge you solved in a ${role} context.`,
        `How do you prioritize tasks when deadlines are tight for ${role} work?`,
        `Walk through your process to ensure quality and reliability in daily execution.`,
    ];

    skills.slice(0, 3).forEach((skill) => {
        questions.push(`Give a practical example where you applied ${skill}.`);
    });

    return { questions };
};

const AGENT_EXECUTION_HANDLERS = {
    job_description_optimization: runJobDescriptionOptimization,
    candidate_screening: runCandidateScreening,
    salary_benchmarking: runSalaryBenchmarking,
    talent_pool_analysis: runTalentPoolAnalysis,
    interview_question_generation: runInterviewQuestionGeneration,
};

const evaluatePermissionBoundary = ({ agent, executionRequest = {} }) => {
    const piiRequested = Boolean(executionRequest.allowPii);
    const mutationRequested = Boolean(executionRequest.mutationRequest);
    const approvalToken = String(executionRequest.approvalToken || '').trim();

    if (piiRequested && !agent.permissions?.canReadPii) {
        return {
            allowed: false,
            status: 'blocked',
            reason: 'PII access denied by agent permission scope',
            approvalRequired: false,
            piiAccessGranted: false,
        };
    }

    if (mutationRequested) {
        if (!agent.permissions?.canMutateCriticalRecords) {
            return {
                allowed: false,
                status: 'blocked',
                reason: 'Critical mutation denied by agent permission scope',
                approvalRequired: false,
                piiAccessGranted: piiRequested,
            };
        }

        if (agent.permissions?.requiresApprovalForMutations && !approvalToken) {
            return {
                allowed: false,
                status: 'blocked',
                reason: 'Mutation approval token required for critical updates',
                approvalRequired: true,
                piiAccessGranted: piiRequested,
            };
        }
    }

    return {
        allowed: true,
        status: 'allowed',
        reason: null,
        approvalRequired: false,
        piiAccessGranted: piiRequested,
    };
};

const executeAgentInSandbox = async ({
    agent,
    actorId,
    tenantId = null,
    executionRequest = {},
} = {}) => {
    const startedAt = process.hrtime.bigint();
    const requestedAction = String(executionRequest.action || agent.scope || '').trim();
    const boundary = evaluatePermissionBoundary({
        agent,
        executionRequest,
    });

    if (!agent?.sandboxMode) {
        throw new Error('Agent sandbox mode is required');
    }

    const inputPreview = sanitizeInputPreview(executionRequest.input || {});
    let resultPreview = {};
    let status = boundary.status;
    let error = null;

    if (!boundary.allowed) {
        error = boundary.reason;
    } else {
        try {
            const handler = AGENT_EXECUTION_HANDLERS[agent.scope];
            if (!handler) {
                throw new Error('Unsupported agent scope');
            }

            const handlerResult = await Promise.resolve(handler({ input: executionRequest.input || {} }));
            resultPreview = handlerResult || {};
            status = 'completed';
        } catch (executionError) {
            status = 'failed';
            error = executionError.message || 'Agent execution failed';
        }
    }

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    const executionLog = await AgentExecutionLog.create({
        agentId: agent._id,
        actorId,
        tenantId,
        scope: agent.scope,
        requestedAction,
        status,
        approvalRequired: boundary.approvalRequired,
        piiAccessRequested: Boolean(executionRequest.allowPii),
        piiAccessGranted: boundary.piiAccessGranted,
        durationMs: Number(durationMs.toFixed(2)),
        inputPreview,
        resultPreview: status === 'completed' ? resultPreview : {},
        error: error ? truncate(error, 500) : null,
    });

    await appendPlatformAuditLog({
        eventType: 'agent.execution',
        actorType: 'agent',
        actorId: agent._id,
        tenantId,
        resourceType: 'agent_execution',
        resourceId: executionLog._id,
        action: requestedAction,
        status: status === 'completed' ? 200 : status === 'blocked' ? 403 : 500,
        metadata: {
            scope: agent.scope,
            executionStatus: status,
            piiAccessRequested: Boolean(executionRequest.allowPii),
            approvalRequired: boundary.approvalRequired,
            blockedReason: status === 'blocked' ? error : null,
        },
    });

    if (status !== 'completed') {
        return {
            success: false,
            status,
            message: error || 'Agent execution failed',
            executionId: executionLog._id,
        };
    }

    return {
        success: true,
        status,
        data: resultPreview,
        executionId: executionLog._id,
    };
};

module.exports = {
    AGENT_EXECUTION_HANDLERS,
    executeAgentInSandbox,
};
