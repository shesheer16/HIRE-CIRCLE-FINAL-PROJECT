const FinancialAuditLog = require('../../models/FinancialAuditLog');

const sanitizeState = (value) => {
    if (value === undefined || value === null) return {};
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return { serializationError: 'state_not_serializable' };
    }
};

const logFinancialAction = async ({
    actorId,
    actionType,
    referenceId,
    previousState = {},
    newState = {},
    metadata = {},
}) => FinancialAuditLog.create({
    actorId,
    actionType,
    referenceId: String(referenceId || ''),
    previousState: sanitizeState(previousState),
    newState: sanitizeState(newState),
    metadata: sanitizeState(metadata),
    timestamp: new Date(),
});

module.exports = {
    logFinancialAction,
};
