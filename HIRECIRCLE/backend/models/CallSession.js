const mongoose = require('mongoose');

const callSessionSchema = new mongoose.Schema({
    roomId: {
        type: String,
        required: true,
        index: true,
    },
    applicationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Application',
        required: true,
        index: true,
    },
    callerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    calleeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    status: {
        type: String,
        enum: ['ringing', 'active', 'rejected', 'ended', 'timeout'],
        default: 'ringing',
        index: true,
    },
    offer: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
    },
    answer: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
    },
    iceCandidates: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
    },
    startedAt: {
        type: Date,
        default: null,
    },
    endedAt: {
        type: Date,
        default: null,
    },
    timeoutAt: {
        type: Date,
        default: null,
    },
}, {
    timestamps: true,
});

callSessionSchema.index({ applicationId: 1, createdAt: -1 });
callSessionSchema.index({ status: 1, timeoutAt: 1 });

module.exports = mongoose.model('CallSession', callSessionSchema);

