const Agent = require('../models/Agent');
const { executeAgentInSandbox } = require('../services/agentSandboxService');

const listAgents = async (req, res) => {
    try {
        const query = {
            isActive: true,
        };

        if (req.tenantContext?.tenantId) {
            query.$or = [
                { tenantId: req.tenantContext.tenantId },
                { tenantId: null },
            ];
        }

        const agents = await Agent.find(query).sort({ rating: -1, createdAt: -1 }).lean();
        return res.json({
            success: true,
            data: agents,
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to list agents' });
    }
};

const registerAgent = async (req, res) => {
    try {
        const payload = req.body || {};
        if (!payload.name || !payload.scope || !payload.description) {
            return res.status(400).json({ message: 'name, scope and description are required' });
        }

        const agent = await Agent.create({
            name: payload.name,
            version: payload.version || '1.0.0',
            description: payload.description,
            owner: req.user._id,
            tenantId: req.tenantContext?.tenantId || null,
            scope: payload.scope,
            permissions: {
                canReadPii: Boolean(payload.permissions?.canReadPii),
                canMutateCriticalRecords: Boolean(payload.permissions?.canMutateCriticalRecords),
                requiresApprovalForMutations: payload.permissions?.requiresApprovalForMutations !== false,
                allowedDataScopes: Array.isArray(payload.permissions?.allowedDataScopes)
                    ? payload.permissions.allowedDataScopes
                    : [],
            },
            pricing: {
                currency: payload.pricing?.currency || 'USD',
                unitAmount: Number(payload.pricing?.unitAmount || 0),
                unit: payload.pricing?.unit || 'execution',
            },
            rating: Number(payload.rating || 0),
            sandboxMode: true,
        });

        return res.status(201).json({
            success: true,
            data: agent,
        });
    } catch (error) {
        return res.status(400).json({ message: error.message || 'Failed to register agent' });
    }
};

const executeAgent = async (req, res) => {
    try {
        const agentId = String(req.params.agentId || '').trim();
        const agent = await Agent.findById(agentId);
        if (!agent || !agent.isActive) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        if (req.tenantContext?.tenantId) {
            const matchesTenant = !agent.tenantId
                || String(agent.tenantId) === String(req.tenantContext.tenantId);
            if (!matchesTenant) {
                return res.status(403).json({ message: 'Agent is outside tenant scope' });
            }
        }

        const result = await executeAgentInSandbox({
            agent,
            actorId: req.user._id,
            tenantId: req.tenantContext?.tenantId || null,
            executionRequest: req.body || {},
        });

        if (!result.success) {
            const statusCode = result.status === 'blocked' ? 403 : 500;
            return res.status(statusCode).json(result);
        }

        return res.json(result);
    } catch (error) {
        return res.status(400).json({ message: error.message || 'Failed to execute agent' });
    }
};

module.exports = {
    listAgents,
    registerAgent,
    executeAgent,
};
