const mongoose = require('mongoose');

const feedbackSchema = mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['bug', 'feature_request', 'general'],
        required: true
    },
    message: {
        type: String,
        required: true
    },
    screenshotUrl: {
        type: String
    },
    status: {
        type: String,
        enum: ['new', 'in_progress', 'resolved'],
        default: 'new'
    }
}, { timestamps: true });

module.exports = mongoose.model('BetaFeedback', feedbackSchema);
