const mongoose = require('mongoose');

const circlePostSchema = new mongoose.Schema({
    circle: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Circle',
        required: true,
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    text: {
        type: String,
        required: true,
        trim: true,
    },
}, {
    timestamps: true,
});

circlePostSchema.index({ circle: 1, createdAt: -1 });

module.exports = mongoose.model('CirclePost', circlePostSchema);
