const crypto = require('crypto');
const Experiment = require('../models/Experiment');

const hashToFloat = (input) => {
    const hash = crypto.createHash('sha256').update(String(input)).digest('hex');
    const slice = hash.slice(0, 12);
    const intValue = Number.parseInt(slice, 16);
    const max = Number.parseInt('ffffffffffff', 16);
    return max > 0 ? intValue / max : 0;
};

const deterministicVariant = ({ userId, key, variantA = 'A', variantB = 'B' }) => {
    const ratio = hashToFloat(`${String(userId)}:${String(key)}`);
    return ratio < 0.5 ? String(variantA) : String(variantB);
};

const getOrCreateExperiment = async ({ key, variantA = 'A', variantB = 'B' }) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
        throw new Error('Experiment key is required');
    }

    await Experiment.updateOne(
        { key: normalizedKey },
        {
            $setOnInsert: {
                key: normalizedKey,
                variantA: String(variantA || 'A'),
                variantB: String(variantB || 'B'),
                userAssignment: {},
                isActive: true,
            },
            $set: {
                variantA: String(variantA || 'A'),
                variantB: String(variantB || 'B'),
            },
        },
        { upsert: true }
    );

    return Experiment.findOne({ key: normalizedKey });
};

const assignUserToExperiment = async ({ userId, key, variantA = 'A', variantB = 'B', persist = true }) => {
    if (!userId) {
        throw new Error('userId is required');
    }

    const experiment = await getOrCreateExperiment({ key, variantA, variantB });
    if (!experiment) {
        throw new Error('Failed to load experiment');
    }

    const assignmentMap = experiment.userAssignment || new Map();
    const existing = assignmentMap.get(String(userId));
    if (existing) {
        return {
            key: experiment.key,
            variant: existing,
            variantA: experiment.variantA,
            variantB: experiment.variantB,
            source: 'persisted',
        };
    }

    const variant = deterministicVariant({
        userId,
        key: experiment.key,
        variantA: experiment.variantA,
        variantB: experiment.variantB,
    });

    if (persist) {
        await Experiment.updateOne(
            { _id: experiment._id },
            {
                $set: {
                    [`userAssignment.${String(userId)}`]: variant,
                },
            }
        );
    }

    return {
        key: experiment.key,
        variant,
        variantA: experiment.variantA,
        variantB: experiment.variantB,
        source: persist ? 'deterministic_persisted' : 'deterministic_runtime',
    };
};

module.exports = {
    deterministicVariant,
    getOrCreateExperiment,
    assignUserToExperiment,
};
