const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminUserSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            index: true,
        },
        password: {
            type: String,
            required: true,
        },
        role: {
            type: String,
            enum: ['super_admin', 'moderator', 'analyst'],
            default: 'moderator',
            index: true,
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
        lastLoginAt: {
            type: Date,
            default: null,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'AdminUser',
            default: null,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

adminUserSchema.pre('save', async function hashPassword() {
    if (!this.isModified('password')) return;
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(String(this.password), salt);
});

adminUserSchema.methods.matchPassword = async function matchPassword(enteredPassword) {
    return bcrypt.compare(String(enteredPassword || ''), String(this.password || ''));
};

module.exports = mongoose.model('AdminUser', adminUserSchema);
