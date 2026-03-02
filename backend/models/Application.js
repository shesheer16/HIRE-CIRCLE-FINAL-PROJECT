const mongoose = require('mongoose');
const {
    CANONICAL_APPLICATION_STATUSES,
    normalizeApplicationStatus,
    canTransition,
} = require('../workflow/applicationStateMachine');

const LEGACY_ALLOWED_STATUSES = [
    'requested',
    'pending',
    'accepted',
    'offer_proposed',
];

const ALL_ALLOWED_STATUSES = Array.from(new Set([
    ...CANONICAL_APPLICATION_STATUSES,
    ...LEGACY_ALLOWED_STATUSES,
]));

const applicationSchema = mongoose.Schema(
    {
        job: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'Job',
        },
        worker: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'WorkerProfile',
        },
        employer: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'User', // Employer User ID
        },
        initiatedBy: {
            type: String,
            required: true,
            enum: ['worker', 'employer'], // who sent the request?
        },
        status: {
            type: String,
            required: true,
            enum: ALL_ALLOWED_STATUSES,
            default: 'applied',
        },
        lastMessage: {
            type: String,
            default: '', // Preview text for the chat list
        },
        statusChangedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        lastActivityAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        conversationLastActiveAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        interviewRequestedAt: {
            type: Date,
            default: null,
        },
        interviewCompletedAt: {
            type: Date,
            default: null,
        },
        offerSentAt: {
            type: Date,
            default: null,
        },
        offerAcceptedAt: {
            type: Date,
            default: null,
        },
        hiredAt: {
            type: Date,
            default: null,
        },
        feedbackRequiredByEmployer: {
            type: Boolean,
            default: false,
            index: true,
        },
        feedbackRequiredByWorker: {
            type: Boolean,
            default: false,
            index: true,
        },
        feedbackCompletedAt: {
            type: Date,
            default: null,
        },
        isArchived: {
            type: Boolean,
            default: false,
            index: true,
        },
        archivedAt: {
            type: Date,
            default: null,
            index: true,
        },
        workflowMeta: {
            lastTransitionActor: {
                type: String,
                default: 'system',
            },
            lastTransitionReason: {
                type: String,
                default: 'init',
            },
            remindersSent: {
                employerNoResponse: {
                    type: Number,
                    default: 0,
                },
                candidateNoResponse: {
                    type: Number,
                    default: 0,
                },
                offerExpiry: {
                    type: Number,
                    default: 0,
                },
            },
        },
        sla: {
            employerResponseHours: {
                type: Number,
                default: null,
                min: 0,
            },
            candidateResponseHours: {
                type: Number,
                default: null,
                min: 0,
            },
            hiringDurationHours: {
                type: Number,
                default: null,
                min: 0,
            },
        },
    },
    {
        timestamps: true,
    }
);

// Prevent duplicate applications for the same job by the same worker
applicationSchema.index({ job: 1, worker: 1 }, { unique: true });
applicationSchema.index({ job: 1 });
applicationSchema.index({ worker: 1 });
applicationSchema.index({ job: 1, worker: 1, status: 1 });
applicationSchema.index({ status: 1 });
applicationSchema.index({ createdAt: -1 });
applicationSchema.index({ employer: 1, status: 1, updatedAt: -1 });
applicationSchema.index({ worker: 1, status: 1, updatedAt: -1 });
applicationSchema.index({ isArchived: 1, status: 1, updatedAt: -1 });
applicationSchema.index({ conversationLastActiveAt: 1, isArchived: 1 });
applicationSchema.index({ feedbackRequiredByEmployer: 1, feedbackRequiredByWorker: 1, status: 1, updatedAt: -1 });

applicationSchema.pre('save', async function validateWorkflowTransition(next) {
    try {
        const now = new Date();
        const normalizedStatus = normalizeApplicationStatus(this.status, this.isNew ? 'applied' : String(this.status || '').toLowerCase());

        if (this.isNew) {
            this.status = normalizedStatus;
            this.statusChangedAt = now;
            this.lastActivityAt = now;
            this.conversationLastActiveAt = this.conversationLastActiveAt || now;
            if (typeof next === 'function') return next();
            return;
        }

        if (this.isModified('status')) {
            const current = await this.constructor.findById(this._id).select('status').lean();
            const currentStatus = normalizeApplicationStatus(current?.status, 'applied');
            const transition = canTransition({
                fromStatus: currentStatus,
                toStatus: normalizedStatus,
                allowNoop: true,
            });

            const skipValidation = Boolean(this.$locals?.skipTransitionValidation);
            if (!skipValidation && !transition.valid) {
                const transitionError = new Error(transition.reason);
                if (typeof next === 'function') return next(transitionError);
                throw transitionError;
            }

            this.status = normalizedStatus;
            if (currentStatus !== normalizedStatus) {
                this.statusChangedAt = now;
            }
            this.lastActivityAt = now;
        }

        if (this.archivedAt && !this.isArchived) {
            this.isArchived = true;
        }
        if (!this.archivedAt && this.isArchived) {
            this.archivedAt = now;
        }

        if (typeof next === 'function') return next();
        return;
    } catch (error) {
        if (typeof next === 'function') return next(error);
        throw error;
    }
});

const Application = mongoose.model('Application', applicationSchema);

module.exports = Application;
