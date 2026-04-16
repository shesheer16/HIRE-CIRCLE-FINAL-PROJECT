/**
 * ChatNote — Private employer notes on a chat/application.
 * SECURITY: Strictly employer-side. Never exposed to worker/job-seeker APIs.
 * AUDIT: All writes are logged via pre-save hook.
 */
const mongoose = require('mongoose');

const ChatNoteSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
      index: true,
    },
    employerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
      maxlength: 5000,
      trim: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    version: {
      type: Number,
      default: 1,
    },
    auditLog: [
      {
        action: { type: String, enum: ['created', 'edited', 'deleted'] },
        at: { type: Date, default: Date.now },
        byEmployerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        previousContent: { type: String },
      },
    ],
  },
  {
    timestamps: true,
    collection: 'chat_notes',
  }
);

// Compound index for fast employer+application lookups
ChatNoteSchema.index({ applicationId: 1, employerId: 1, isDeleted: 1 });

// Pre-save audit hook
ChatNoteSchema.pre('save', function (next) {
  if (this.isNew) {
    this.auditLog.push({
      action: 'created',
      at: new Date(),
      byEmployerId: this.employerId,
    });
  } else if (this.isModified('content')) {
    this.version += 1;
    this.auditLog.push({
      action: 'edited',
      at: new Date(),
      byEmployerId: this.employerId,
      previousContent: this._previousContent || '[unknown]',
    });
  }
  next();
});

module.exports = mongoose.model('ChatNote', ChatNoteSchema);
