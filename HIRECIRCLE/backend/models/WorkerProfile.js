const mongoose = require('mongoose');

const workerProfileSchema = mongoose.Schema(
  {
    // Link to the main User account we created in Phase 1
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    // Base Information (Phase 3, Task 13)
    firstName: { type: String, required: true },
    lastName: { type: String },
    city: { type: String, required: true },
    district: { type: String, default: null, index: true },
    mandal: { type: String, default: null, index: true },
    panchayat: { type: String, default: null },
    locationLabel: { type: String, default: null },
    avatar: { type: String, default: null },
    country: { type: String, default: 'IN', uppercase: true, index: true },
    language: { type: String, default: null },
    totalExperience: { type: Number, default: 0 },
    preferredShift: {
      type: String,
      enum: ['Day', 'Night', 'Flexible'],
      default: 'Flexible',
    },
    licenses: [{ type: String }],
    lastActiveAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    
    // AI-Extracted Video Data (Phase 3, Task 17)
    // This will be populated by the Gemini extraction logic later
    videoIntroduction: {
      videoUrl: { type: String }, // Path to the webm/mp4 file
      transcript: { type: String }, // Text from Whisper
      rawExtraction: { type: mongoose.Schema.Types.Mixed, default: null },
    },

    // Role-Specific Profiles (Phase 3, Task 14)
    // A worker can have multiple skill sets (e.g., "Cook" and "Maid")
    roleProfiles: [
      {
        profileId: {
          type: String,
          default: () => new mongoose.Types.ObjectId().toString(),
        },
        roleName: { type: String, required: true }, // e.g., "COOK"
        experienceInRole: { type: Number },
        expectedSalary: { type: Number },
        skills: [{ type: String }], // Array of tags like ["South Indian", "Tiffins"]
        activeProfile: {
          type: Boolean,
          default: false,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        lastUpdated: { type: Date, default: Date.now },
      }
    ],

    // Global settings for matching
    isAvailable: { type: Boolean, default: true },
    availabilityWindowDays: {
      type: Number,
      enum: [0, 15, 30],
      default: 0,
    },
    openToRelocation: {
      type: Boolean,
      default: false,
    },
    openToNightShift: {
      type: Boolean,
      default: false,
    },
    interviewVerified: {
      type: Boolean,
      default: false,
      index: true,
    },
    settings: {
      matchPreferences: {
        maxCommuteDistanceKm: { type: Number, default: 25, min: 1, max: 300 },
        salaryExpectationMin: { type: Number, default: null },
        salaryExpectationMax: { type: Number, default: null },
        preferredShiftTimes: {
          type: [String],
          default: [],
        },
        roleClusters: {
          type: [String],
          default: [],
        },
        minimumMatchTier: {
          type: String,
          enum: ['STRONG', 'GOOD', 'POSSIBLE'],
          default: 'GOOD',
        },
      },
    },
    reliabilityScore: {
      type: Number,
      default: 0.75,
      min: 0,
      max: 1,
      index: true,
    },
    interviewIntelligence: {
      profileQualityScore: {
        type: Number,
        default: 0,
        min: 0,
        max: 1,
      },
      communicationClarityScore: {
        type: Number,
        default: 0,
        min: 0,
        max: 1,
      },
      confidenceLanguageScore: {
        type: Number,
        default: 0,
        min: 0,
        max: 1,
      },
      ambiguityRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 1,
      },
      slotCompletenessRatio: {
        type: Number,
        default: 0,
        min: 0,
        max: 1,
      },
      salaryOutlierFlag: {
        type: Boolean,
        default: false,
      },
      salaryMedianForRoleCity: {
        type: Number,
        default: null,
      },
      salaryRealismRatio: {
        type: Number,
        default: null,
      },
      salaryAlignmentStatus: {
        type: String,
        enum: ['ALIGNED', 'OUTLIER'],
        default: 'ALIGNED',
      },
      profileStrengthLabel: {
        type: String,
        enum: ['Weak', 'Good', 'Strong'],
        default: 'Weak',
      },
      communicationLabel: {
        type: String,
        enum: ['Clear', 'Good', 'Improving'],
        default: 'Improving',
      },
      lastInterviewAt: {
        type: Date,
        default: null,
      },
    },
    updated_at: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Match Engine Optimization: Indexing for fast searches (Phase 5)
workerProfileSchema.index({ city: 1, 'roleProfiles.roleName': 1 });
workerProfileSchema.index({ district: 1, mandal: 1, 'roleProfiles.roleName': 1 });
workerProfileSchema.index({ user: 1 }, { unique: true });
workerProfileSchema.index({ user: 1, 'roleProfiles.profileId': 1 });
workerProfileSchema.index({ user: 1, 'roleProfiles.activeProfile': 1 });
workerProfileSchema.index({ 'interviewIntelligence.profileQualityScore': -1 });
workerProfileSchema.index({ 'interviewIntelligence.communicationClarityScore': -1 });
workerProfileSchema.index({ 'interviewIntelligence.salaryOutlierFlag': 1 });
workerProfileSchema.index({ updated_at: -1 });

workerProfileSchema.pre('save', function syncUpdatedAt(next) {
  this.updated_at = new Date();
  if (typeof next === 'function') {
    next();
  }
});

['findOneAndUpdate', 'updateOne', 'updateMany'].forEach((hook) => {
  workerProfileSchema.pre(hook, function syncUpdatedAtOnUpdate(next) {
    const update = this.getUpdate ? (this.getUpdate() || {}) : {};
    const nextUpdate = { ...update };
    nextUpdate.$set = { ...(nextUpdate.$set || {}), updated_at: new Date() };
    if (this.setUpdate) {
      this.setUpdate(nextUpdate);
    }
    if (typeof next === 'function') {
      next();
    }
  });
});

const WorkerProfile = mongoose.model('WorkerProfile', workerProfileSchema);

module.exports = WorkerProfile;
