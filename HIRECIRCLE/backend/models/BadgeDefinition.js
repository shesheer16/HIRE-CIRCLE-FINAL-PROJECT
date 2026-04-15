const mongoose = require('mongoose');

const badgeDefinitionSchema = new mongoose.Schema(
    {
        badgeKey: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            required: true,
            trim: true,
        },
        criteria: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        active: {
            type: Boolean,
            default: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

badgeDefinitionSchema.index({ active: 1, badgeKey: 1 });

module.exports = mongoose.model('BadgeDefinition', badgeDefinitionSchema);
