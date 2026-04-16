const mongoose = require('mongoose');

const cityEmployerPipelineSchema = mongoose.Schema(
    {
        city: {
            type: String,
            required: true,
            index: true,
        },
        companyName: {
            type: String,
            required: true,
            trim: true,
        },
        contactName: {
            type: String,
            default: '',
            trim: true,
        },
        phone: {
            type: String,
            default: '',
            trim: true,
        },
        stage: {
            type: String,
            enum: ['lead', 'demo_done', 'trial_started', 'converted_paid', 'repeat_hiring', 'lost'],
            default: 'lead',
            index: true,
        },
        source: {
            type: String,
            default: 'unknown',
            trim: true,
            index: true,
        },
        owner: {
            type: String,
            default: '',
            trim: true,
        },
        trialStartedAt: {
            type: Date,
            default: null,
        },
        convertedPaidAt: {
            type: Date,
            default: null,
        },
        repeatHiringAt: {
            type: Date,
            default: null,
        },
        notes: {
            type: String,
            default: '',
        },
    },
    {
        timestamps: true,
    }
);

cityEmployerPipelineSchema.index({ city: 1, stage: 1, updatedAt: -1 });
cityEmployerPipelineSchema.index({ city: 1, source: 1, createdAt: -1 });

module.exports = mongoose.model('CityEmployerPipeline', cityEmployerPipelineSchema);
