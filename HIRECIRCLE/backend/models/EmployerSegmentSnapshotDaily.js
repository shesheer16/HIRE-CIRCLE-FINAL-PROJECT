const mongoose = require('mongoose');
const { applyAppendOnlyGuards } = require('./_appendOnly');

const segmentRowSchema = new mongoose.Schema(
    {
        segmentKey: { type: String, required: true },
        industry: { type: String, default: 'unknown' },
        hiringFrequencyBand: { type: String, default: 'low' },
        budgetBand: { type: String, default: 'low' },
        responseSpeedBand: { type: String, default: 'slow' },
        employerCount: { type: Number, default: 0 },
        conversionRate: { type: Number, default: 0 },
        churnRiskRate: { type: Number, default: 0 },
    },
    { _id: false }
);

const employerSegmentSnapshotDailySchema = new mongoose.Schema(
    {
        dateKey: { type: String, required: true, unique: true, index: true },
        dayStartUTC: { type: Date, required: true },
        dayEndUTC: { type: Date, required: true },
        segmentRows: { type: [segmentRowSchema], default: [] },
        highValueSegments: { type: [segmentRowSchema], default: [] },
        lowConversionSegments: { type: [segmentRowSchema], default: [] },
        churnRiskSegments: { type: [segmentRowSchema], default: [] },
        computedAt: { type: Date, default: Date.now, index: true },
    },
    {
        timestamps: true,
    }
);

employerSegmentSnapshotDailySchema.index({ computedAt: -1 });
applyAppendOnlyGuards(employerSegmentSnapshotDailySchema);

module.exports = mongoose.model('EmployerSegmentSnapshotDaily', employerSegmentSnapshotDailySchema);

