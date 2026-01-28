const mongoose = require('mongoose');

const jobSchema = mongoose.Schema(
    {
        employerId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'User',
        },
        title: {
            type: String,
            required: [true, 'Please add a job title'],
        },
        companyName: {
            type: String,
            required: [true, 'Please add a company name'],
        },
        salaryRange: {
            type: String,
            required: [true, 'Please add a salary range'],
        },
        location: {
            type: String,
            required: [true, 'Please add a location'],
        },
        requirements: [
            {
                type: String,
            },
        ],
        screeningQuestions: [
            {
                type: String,
            },
        ],
        minSalary: {
            type: Number, // Extracted from salaryRange or default
        },
        maxSalary: {
            type: Number, // Extracted from salaryRange or default
        },
        shift: {
            type: String,
            enum: ['Day', 'Night', 'Flexible'],
            default: 'Flexible'
        },
        mandatoryLicenses: [
            {
                type: String, // e.g., "Heavy Vehicle", "Commercial"
            }
        ],
        isOpen: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('Job', jobSchema);
