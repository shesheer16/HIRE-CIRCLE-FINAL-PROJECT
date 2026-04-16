const mongoose = require('mongoose');

const cityHiringDailySnapshotSchema = mongoose.Schema(
    {
        city: {
            type: String,
            required: true,
            index: true,
        },
        day: {
            type: Date,
            required: true,
            index: true,
        },
        metrics: {
            applications: { type: Number, default: 0 },
            shortlisted: { type: Number, default: 0 },
            hired: { type: Number, default: 0 },
            interviewsCompleted: { type: Number, default: 0 },
            retention30d: { type: Number, default: 0 },
            offerProposed: { type: Number, default: 0 },
            offerAccepted: { type: Number, default: 0 },
            noShowNumerator: { type: Number, default: 0 },
            noShowDenominator: { type: Number, default: 0 },
        },
    },
    {
        timestamps: true,
    }
);

cityHiringDailySnapshotSchema.index({ city: 1, day: 1 }, { unique: true });

module.exports = mongoose.model('CityHiringDailySnapshot', cityHiringDailySnapshotSchema);
