const mongoose = require('mongoose');

const organizationSchema = mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    billingEmail: {
        type: String,
        required: true
    },
    subscriptionTier: {
        type: String,
        enum: ['free', 'pro', 'enterprise'],
        default: 'free'
    },
    ssoEnabled: {
        type: Boolean,
        default: false
    },
    ssoDomain: {
        type: String
    }
}, { timestamps: true });

module.exports = mongoose.model('Organization', organizationSchema);
