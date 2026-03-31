const { REQUIRED_SLOT_FIELDS } = require('../config/smartInterviewSlotConfig');

const MIN_REQUIRED_CONFIDENCE = 0.75;

const hasValue = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
};

const getNextMissingSlot = (slotState = {}, slotConfidence = {}) => {
    for (const field of REQUIRED_SLOT_FIELDS) {
        const valuePresent = hasValue(slotState[field]);
        const confidence = Number(slotConfidence[field] ?? 0);
        if (!valuePresent || confidence < MIN_REQUIRED_CONFIDENCE) {
            return field;
        }
    }
    return null;
};

module.exports = {
    MIN_REQUIRED_CONFIDENCE,
    getNextMissingSlot,
};
