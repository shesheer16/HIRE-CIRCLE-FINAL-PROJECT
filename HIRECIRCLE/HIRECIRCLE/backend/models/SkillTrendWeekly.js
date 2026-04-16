const mongoose = require('mongoose');
const { applyAppendOnlyGuards } = require('./_appendOnly');

const skillTrendWeeklySchema = new mongoose.Schema(
    {
        weekKey: { type: String, required: true, index: true },
        weekStartUTC: { type: Date, required: true },
        weekEndUTC: { type: Date, required: true },
        skill: { type: String, required: true, index: true, trim: true, lowercase: true },
        searchedCount: { type: Number, default: 0, min: 0 },
        hiredCount: { type: Number, default: 0, min: 0 },
        growthRateWoW: { type: Number, default: 0 },
        averageSalary: { type: Number, default: 0 },
        highPaying: { type: Boolean, default: false, index: true },
        computedAt: { type: Date, default: Date.now, index: true },
    },
    {
        timestamps: true,
    }
);

skillTrendWeeklySchema.index({ weekKey: 1, skill: 1 }, { unique: true });
skillTrendWeeklySchema.index({ weekKey: 1, hiredCount: -1 });
applyAppendOnlyGuards(skillTrendWeeklySchema);

module.exports = mongoose.model('SkillTrendWeekly', skillTrendWeeklySchema);

