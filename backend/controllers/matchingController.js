const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');
const User = require('../models/userModel');
const { getBatchMatchScores } = require('../services/geminiService');
const redisClient = require('../config/redis');
const algo = require('../utils/matchingAlgorithm'); // v7.0 Logic


// Fix 3.1: Redis-backed cache with Map fallback
const matchCache = new Map(); // Fallback if Redis unavailable
const CACHE_TTL_SEC = 604800; // 7 days in seconds (Redis format)

// Fix 2.1: Unified cache key function (eliminates emp_/can_ asymmetry)
const getCacheKey = (jobId, workerId) => `match:${jobId}:${workerId}`;

// Helper: Get from cache (try Redis first, fallback to Map)
const getFromCache = async (key) => {
    try {
        if (redisClient.isOpen) {
            const data = await redisClient.get(key);
            if (data) {
                console.log(`🔵 [REDIS GET] Key: ${key.substring(0, 30)}...`);
                return JSON.parse(data);
            }
        }
    } catch (error) {
        console.error('❌ [REDIS GET ERROR]:', error.message);
    }

    // Fallback to Map
    const cached = matchCache.get(key);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_SEC * 1000)) {
        console.log(`🟡 [MAP GET] Key: ${key.substring(0, 30)}...`);
        return cached.data;
    }
    return null;
};

// Helper: Set to cache (try Redis first, fallback to Map)
const setToCache = async (key, value) => {
    try {
        if (redisClient.isOpen) {
            // Set asynchronously, do not await if we want to return results faster
            redisClient.setEx(key, CACHE_TTL_SEC, JSON.stringify(value)).catch(err => {
                console.error('❌ [REDIS SET ERROR]:', err.message);
            });
            console.log(`🔵 [REDIS SET] Key: ${key.substring(0, 30)}...`);
            return;
        }
    } catch (error) {
        console.error('❌ [REDIS SET ERROR]:', error.message);
    }

    // Fallback to Map
    matchCache.set(key, { data: value, timestamp: Date.now() });
    console.log(`🟡 [MAP SET] Key: ${key.substring(0, 30)}...`);
};

// @desc Get ranked workers (Employer View) - v7.0 ALGORITHM
const getMatchesForEmployer = async (req, res) => {
    try {
        console.log('🔍 [v7.0] Employer Match Request for jobId:', req.params.jobId);

        // 1. Validation & Data Fetching
        const employer = await User.findById(req.user._id);
        if (!employer.hasCompletedProfile) {
            return res.status(403).json({ message: 'Please complete your profile first' });
        }

        const job = await Job.findById(req.params.jobId);
        if (!job || !job.isOpen) {
            return res.status(404).json({ message: 'Job not found or closed' });
        }

        // 2. Database Filtering (Optimized Phase 1)
        // Fetch workers who are available and have at least one role
        const limit = 200; // Increased limit for hard gates
        const workers = await WorkerProfile.find({ isAvailable: true })
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('user', 'name hasCompletedProfile');

        const validWorkers = workers.filter(w => w.user && w.user.hasCompletedProfile && w.roleProfiles?.length > 0);
        console.log(`✅ [v7.0] Initial Candidates: ${validWorkers.length}`);

        const results = [];

        for (const worker of validWorkers) {
            // Role Match (Simple Check for MVP - expand to Fuzzy later)
            // For now, checks if ANY of the worker's roles match the Job Title partially
            const roleData = worker.roleProfiles.find(r =>
                job.title.toLowerCase().includes(r.roleName.toLowerCase()) ||
                r.roleName.toLowerCase().includes(job.title.toLowerCase())
            );

            if (!roleData) {
                // Phase 1 Rejection: Different Category
                continue;
            }

            // Phase 2: Hard Gates
            if (!algo.hardGates(job, worker, roleData)) {
                // console.log(`⛔ Gate Blocked: ${worker._id}`);
                continue;
            }

            // Phase 3: Quality
            const quality = algo.calculateQualityFactor(job, worker);
            if (quality === 0) continue;

            // Phase 4: Perspective Weighting (Employer View)
            // Employer cares more about Skills (25%) and Role (35%)
            // We adjust basic weights slightly or use standard Composite

            // Phase 5: Dimension Scoring
            const salScore = algo.salaryScore(roleData.expectedSalary, job.maxSalary);
            const expScore = algo.experienceScore(roleData.experienceInRole, job.requirements.join(' ').match(/\d+/) || 0); // Naive scaling from reqs
            const skillScore = algo.skillsScore(roleData.skills, job.requirements);

            // Phase 6: Composite Score
            // Using slightly modified weights for Recruiter View if needed, 
            // but for v7.0 baseline we use the global configuration.
            const criticalScore = algo.criticalComposite(salScore, expScore, skillScore);
            const softBonus = algo.calculateSoftBonus(job, worker);

            let finalScore = (criticalScore + softBonus) * quality;
            finalScore = Math.min(Math.max(finalScore, 0), 1.0); // Clamp 0-1

            if (finalScore >= algo.CONFIG.DISPLAY_THRESHOLD) {
                results.push({
                    worker,
                    matchScore: Math.round(finalScore * 100),
                    tier: finalScore >= 0.85 ? 'Strong Match' : finalScore >= 0.75 ? 'Good Match' : 'Possible Match',
                    labels: [
                        roleData.roleName,
                        `${Math.round(skillScore * 100)}% Skill Match`,
                        finalScore >= 0.85 ? 'Highly Recommended' : ''
                    ].filter(Boolean)
                });
            }
        }

        // Phase 8: Ranking
        results.sort((a, b) => b.matchScore - a.matchScore);
        const topResults = results.slice(0, 20); // Top-20 Rule

        console.log(`🎯 [v7.0] Returned ${topResults.length} matches`);
        res.json(topResults);

    } catch (error) {
        console.error("❌ [v7.0 FATAL] Employer Match Error:", error);
        res.status(500).json({ message: 'Matching failed' });
    }
};

// @desc Get ranked jobs for the logged-in worker (Candidate View) - v7.0 ALGORITHM
const getMatchesForCandidate = async (req, res) => {
    try {
        console.log('🔍 [v7.0] Candidate Match Request for user:', req.user._id);

        const user = await User.findById(req.user._id);
        if (!user.hasCompletedProfile) {
            return res.status(403).json({ message: 'Please complete your profile first' });
        }

        const worker = await WorkerProfile.findOne({ user: req.user._id });
        if (!worker || !worker.isAvailable || !worker.roleProfiles?.length) {
            return res.status(400).json({ message: 'Please add a role to start matching' });
        }

        // Fetch Open Jobs not posted by this user
        const limit = 200;
        const jobs = await Job.find({ isOpen: true, employerId: { $ne: req.user._id } })
            .sort({ createdAt: -1 })
            .limit(limit);

        console.log(`✅ [v7.0] Found ${jobs.length} potential jobs`);

        const results = [];

        for (const job of jobs) {
            // Find the BEST fitting role from the worker's multiple roles
            // Logic: Calculate score for each role, take the max.

            let bestMatchForJob = null;
            let maxScore = -1;

            for (const roleData of worker.roleProfiles) {
                // Phase 1: Category Match
                if (!job.title.toLowerCase().includes(roleData.roleName.toLowerCase()) &&
                    !roleData.roleName.toLowerCase().includes(job.title.toLowerCase())) {
                    continue;
                }

                // Phase 2: Hard Gates
                if (!algo.hardGates(job, worker, roleData)) continue;

                // Phase 3: Quality
                const quality = algo.calculateQualityFactor(job, worker);

                // Phase 5: Dimension Scoring
                // Note: For Candidate View, Salary Score is inverted? 
                // No, "Salary Score" checks if Offer >= Expectation. This applies to both views.
                const salScore = algo.salaryScore(roleData.expectedSalary, job.maxSalary);

                // Derive numeric experience from job requirements (naive regex)
                const reqExp = job.requirements.join(' ').match(/(\d+)\s+years?/i)?.[1] || 0;
                const expScore = algo.experienceScore(roleData.experienceInRole, reqExp);

                const skillScore = algo.skillsScore(roleData.skills, job.requirements);

                // Phase 6: Composite
                // Perspective Weighting: Candidate cares more about Salary (20%) and Location (25%)
                // We use standard weights for now but this is where W_CANDIDATE_* config would apply.
                const criticalScore = algo.criticalComposite(salScore, expScore, skillScore);
                const softBonus = algo.calculateSoftBonus(job, worker);

                let totalScore = (criticalScore + softBonus) * quality;
                totalScore = Math.min(Math.max(totalScore, 0), 1.0);

                if (totalScore > maxScore) {
                    maxScore = totalScore;
                    bestMatchForJob = {
                        job,
                        matchScore: Math.round(totalScore * 100),
                        roleUsed: roleData.roleName,
                        whyYouFit: `Matches your ${roleData.roleName} profile`,
                        labels: [
                            maxScore >= 0.85 ? 'Top Pay' : '',
                            job.shift ? `${job.shift} Shift` : ''
                        ].filter(Boolean)
                    };
                }
            }

            if (bestMatchForJob && bestMatchForJob.matchScore >= (algo.CONFIG.DISPLAY_THRESHOLD * 100)) {
                results.push(bestMatchForJob);
            }
        }

        results.sort((a, b) => b.matchScore - a.matchScore);
        const topResults = results.slice(0, 20);

        console.log(`🎯 [v7.0] Returned ${topResults.length} matches for candidate`);
        res.json(topResults);

    } catch (error) {
        console.error("❌ [v7.0 FATAL] Candidate Match Error:", error);
        res.status(500).json({ message: 'Candidate match failed' });
    }
};

module.exports = { getMatchesForEmployer, getMatchesForCandidate, matchCache };