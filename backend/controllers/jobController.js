const Job = require('../models/Job');
const { suggestJobRequirements } = require('../services/geminiService');
const redisClient = require('../config/redis');
const { matchCache } = require('./matchingController');

// @desc    Create a new job
// @route   POST /api/jobs/
// @access  Protected
const createJob = async (req, res) => {
    const { title, companyName, salaryRange, location, requirements, screeningQuestions, minSalary, maxSalary, shift, mandatoryLicenses } = req.body;

    try {
        const job = await Job.create({
            employerId: req.user._id,
            title,
            companyName,
            salaryRange,
            location,
            requirements: requirements || [],
            screeningQuestions: screeningQuestions || [],
            minSalary,
            maxSalary,
            shift: shift || 'Flexible',
            mandatoryLicenses: mandatoryLicenses || []
        });

        res.status(201).json({
            success: true,
            data: job,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get all jobs posted by the logged-in employer
// @route   GET /api/jobs/my-jobs
// @access  Protected
const getEmployerJobs = async (req, res) => {
    try {
        const jobs = await Job.find({ employerId: req.user._id }).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: jobs.length,
            data: jobs,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get AI-suggested requirements for a job title
// @route   POST /api/jobs/suggest
// @access  Protected
const suggestRequirements = async (req, res) => {
    const { jobTitle } = req.body;

    if (!jobTitle) {
        return res.status(400).json({
            success: false,
            message: 'Please provide a job title'
        });
    }

    try {
        const suggestions = await suggestJobRequirements(jobTitle);

        res.status(200).json({
            success: true,
            data: suggestions,
        });
    } catch (error) {
        console.error('AI Suggestion Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to generate AI suggestions'
        });
    }
};

// Helper: Clear all match cache entries for a specific job (prevent ghost matches)
const clearJobMatches = async (jobId) => {
    let totalDeleted = 0;

    try {
        // Clear from Redis
        if (redisClient && redisClient.isOpen) {
            const pattern = `match:${jobId}:*`;
            console.log(`🗑️ [CLEANUP] Scanning Redis for pattern: ${pattern}`);

            const keys = await redisClient.keys(pattern);
            if (keys.length > 0) {
                await redisClient.del(keys);
                totalDeleted += keys.length;
                console.log(`✅ [CLEANUP] Deleted ${keys.length} Redis cache entries`);
            } else {
                console.log(`ℹ️ [CLEANUP] No Redis cache entries found for job ${jobId}`);
            }
        }
    } catch (redisError) {
        console.error('❌ [CLEANUP REDIS ERROR]:', redisError.message);
        // Don't throw - continue to Map cleanup
    }

    try {
        // Clear from Map fallback
        if (matchCache) {
            let mapDeletedCount = 0;
            for (const [key, value] of matchCache.entries()) {
                if (key.startsWith(`match:${jobId}:`)) {
                    matchCache.delete(key);
                    mapDeletedCount++;
                }
            }
            if (mapDeletedCount > 0) {
                totalDeleted += mapDeletedCount;
                console.log(`✅ [CLEANUP] Deleted ${mapDeletedCount} Map cache entries`);
            }
        }
    } catch (mapError) {
        console.error('❌ [CLEANUP MAP ERROR]:', mapError.message);
        // Don't throw - cache cleanup failure shouldn't block job deletion
    }

    console.log(`🎯 [CLEANUP COMPLETE] Total cache entries cleared: ${totalDeleted}`);
    return totalDeleted;
};

// @desc    Delete a job
// @route   DELETE /api/jobs/:id
// @access  Protected
const deleteJob = async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);

        if (!job) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        // Verify ownership
        if (job.employerId.toString() !== req.user._id.toString()) {
            return res.status(401).json({ success: false, message: 'Not authorized' });
        }

        // CRITICAL: Clear all cached matches for this job BEFORE deletion
        console.log(`🗑️ [JOB DELETE] Clearing all matches for job ${job._id}...`);
        const deletedCount = await clearJobMatches(job._id);

        await job.deleteOne();

        res.status(200).json({
            success: true,
            message: 'Job and all associated matches deleted successfully',
            cacheEntriesCleared: deletedCount
        });
    } catch (error) {
        console.error('❌ [JOB DELETE ERROR]:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update a job
// @route   PUT /api/jobs/:id
// @access  Protected
const updateJob = async (req, res) => {
    try {
        let job = await Job.findById(req.params.id);

        if (!job) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        // Verify ownership
        if (job.employerId.toString() !== req.user._id.toString()) {
            return res.status(401).json({ success: false, message: 'Not authorized' });
        }

        // Allowed fields to update
        const { title, companyName, salaryRange, location, requirements } = req.body;

        job.title = title || job.title;
        job.companyName = companyName || job.companyName;
        job.salaryRange = salaryRange || job.salaryRange;
        job.location = location || job.location;

        // Handle requirements array from string or array
        if (requirements) {
            job.requirements = Array.isArray(requirements)
                ? requirements
                : requirements.split(',').map(s => s.trim());
        }

        const updatedJob = await job.save();

        res.status(200).json({ success: true, data: updatedJob });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createJob,
    getEmployerJobs,
    suggestRequirements,
    deleteJob,
    updateJob,
    clearJobMatches // Export for testing
};