const mongoose = require('mongoose');

const employerProfileSchema = mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'User',
        },
        companyName: {
            type: String,
            required: true
        },
        industry: {
            type: String
        },
        description: {
            type: String,
            default: '',
        },
        location: {
            type: String,
            required: true
        },
        contactPerson: {
            type: String,
            default: '',
        },
        country: {
            type: String,
            default: 'IN',
            uppercase: true,
            index: true,
        },
        logoUrl: {
            type: String
        },
        videoIntroduction: {
            videoUrl: { type: String },
            transcript: { type: String }
        },
        website: {
            type: String
        }
    },
    {
        timestamps: true,
    }
);

employerProfileSchema.index({ user: 1 });

const EmployerProfile = mongoose.model('EmployerProfile', employerProfileSchema);

module.exports = EmployerProfile;
