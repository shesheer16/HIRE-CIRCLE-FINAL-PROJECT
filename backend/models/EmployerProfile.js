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
            required: true,
        },
        industry: {
            type: String, // Tagline or Industry
        },
        location: {
            type: String,
            required: true,
        },
        logoUrl: {
            type: String, // URL to uploaded logo
        },
        // Add other employer-specific fields here if needed
    },
    {
        timestamps: true,
    }
);

const EmployerProfile = mongoose.model('EmployerProfile', employerProfileSchema);

module.exports = EmployerProfile;
