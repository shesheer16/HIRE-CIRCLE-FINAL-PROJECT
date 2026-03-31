const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    applicationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Application',
        required: true,
        index: true // Optimized query performance for chat history
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    senderRole: {
        type: String,
        enum: ['candidate', 'worker', 'recruiter', 'employer'],
        default: 'candidate',
        index: true,
    },
    type: {
        type: String,
        enum: ['text', 'audio', 'file'],
        default: 'text',
        index: true,
    },
    text: {
        type: String,
        required: true
    },
    transcript: {
        type: String,
        default: '',
    },
    audioUrl: {
        type: String,
        default: '',
    },
    attachmentUrl: {
        type: String,
        default: '',
    },
    mimeType: {
        type: String,
        default: '',
    },
    sizeBytes: {
        type: Number,
        default: null,
    },
    dedupeKey: {
        type: String,
        default: null,
    },
    readBy: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    isSoftDeleted: {
        type: Boolean,
        default: false,
        index: true,
    },
    softDeletedAt: {
        type: Date,
        default: null,
    },
    softDeleteReason: {
        type: String,
        default: null,
    },
}, {
    timestamps: true
});

messageSchema.index({ applicationId: 1, createdAt: -1 });
messageSchema.index({ createdAt: -1 });
messageSchema.index({ applicationId: 1, dedupeKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Message', messageSchema);
