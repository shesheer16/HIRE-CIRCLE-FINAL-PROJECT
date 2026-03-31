const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema(
    {
        applicationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Application',
            required: true,
            unique: true,
            index: true,
        },
        employerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        candidateId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        unlocked: {
            type: Boolean,
            default: false,
            index: true,
        },
        unlockedAt: {
            type: Date,
            default: null,
        },
        updated_at: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
        collection: 'chats',
    }
);

chatSchema.pre('save', function syncUpdatedAt(next) {
    this.updated_at = new Date();
    if (typeof next === 'function') next();
});

['findOneAndUpdate', 'updateOne', 'updateMany'].forEach((hook) => {
    chatSchema.pre(hook, function syncUpdatedAtOnUpdate(next) {
        const update = this.getUpdate ? (this.getUpdate() || {}) : {};
        const nextUpdate = { ...update };
        nextUpdate.$set = { ...(nextUpdate.$set || {}), updated_at: new Date() };
        if (this.setUpdate) {
            this.setUpdate(nextUpdate);
        }
        if (typeof next === 'function') next();
    });
});

module.exports = mongoose.model('Chat', chatSchema);

