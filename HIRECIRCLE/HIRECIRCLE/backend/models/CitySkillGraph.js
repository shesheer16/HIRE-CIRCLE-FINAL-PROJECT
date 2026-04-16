const mongoose = require('mongoose');

const citySkillGraphSchema = mongoose.Schema(
    {
        city: {
            type: String,
            required: true,
            index: true,
        },
        skill: {
            type: String,
            required: true,
            index: true,
        },
        roleCluster: {
            type: String,
            required: true,
            index: true,
        },
        salaryBand: {
            type: String,
            enum: ['low', 'mid', 'high', 'premium', 'unknown'],
            default: 'unknown',
            index: true,
        },
        coOccurrenceFrequency: {
            type: Number,
            default: 0,
        },
        hireSuccessProbability: {
            type: Number,
            default: 0,
        },
        computedDay: {
            type: Date,
            default: Date.now,
            index: true,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

citySkillGraphSchema.index(
    { city: 1, skill: 1, roleCluster: 1, salaryBand: 1, computedDay: -1 },
    { unique: true }
);

module.exports = mongoose.model('CitySkillGraph', citySkillGraphSchema);
