const mongoose = require('mongoose');
const { applyAppendOnlyGuards } = require('./_appendOnly');

const strategicInsightSchema = new mongoose.Schema(
    {
        dateKey: { type: String, required: true, index: true },
        insightType: { type: String, required: true, index: true },
        severity: {
            type: String,
            enum: ['info', 'warning', 'critical'],
            default: 'info',
            index: true,
        },
        title: { type: String, required: true },
        message: { type: String, required: true },
        deterministicRule: { type: String, required: true },
        evidence: { type: mongoose.Schema.Types.Mixed, default: {} },
        generatedAt: { type: Date, default: Date.now, index: true },
    },
    {
        timestamps: true,
    }
);

strategicInsightSchema.index({ dateKey: 1, insightType: 1, deterministicRule: 1 }, { unique: true });
strategicInsightSchema.index({ generatedAt: -1, severity: 1 });
applyAppendOnlyGuards(strategicInsightSchema);

module.exports = mongoose.model('StrategicInsight', strategicInsightSchema);
