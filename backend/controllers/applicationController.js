const Application = require('../models/Application');
const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');

// @desc    Send Connection Request (Worker applies OR Employer invites)
// @route   POST /api/applications
// @access  Private
const sendRequest = async (req, res) => {
    const { jobId, workerId, initiatedBy } = req.body;

    try {
        // 1. Validation
        if (!jobId || !workerId || !initiatedBy) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ message: 'Job not found' });

        // 2. Check for existing application
        const existingApp = await Application.findOne({ job: jobId, worker: workerId });
        if (existingApp) {
            return res.status(400).json({ message: 'Application already exists' });
        }

        // 3. Create Application
        // Employer ID comes from Job document for consistency
        const application = await Application.create({
            job: jobId,
            worker: workerId,
            employer: job.employerId,
            initiatedBy,
            status: 'pending',
            lastMessage: initiatedBy === 'worker' ? 'Applied for this job' : 'Invited you to apply'
        });

        res.status(201).json(application);
    } catch (error) {
        console.error("Send Request Error:", error);
        res.status(500).json({ message: 'Request failed' });
    }
};

// @desc    Update Application Status (Accept/Reject)
// @route   PUT /api/applications/:id/status
// @access  Private
const updateStatus = async (req, res) => {
    const { status } = req.body; // 'accepted' or 'rejected'
    const { id } = req.params;

    if (!['accepted', 'rejected'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status' });
    }

    try {
        const application = await Application.findById(id);
        if (!application) return res.status(404).json({ message: 'Application not found' });

        // Verify authorization (Only the recipient can accept/reject ideally, 
        // but for now we check if user is involved)
        // In a strictly secure app, we'd check initiatedBy:
        // if initiatedBy 'worker', only employer can accept.
        // if initiatedBy 'employer', only worker can accept.
        // For MVP, we presume the frontend handles the UI logic and backend just updates.

        application.status = status;
        if (status === 'accepted') {
            application.lastMessage = "Connection Accepted. Chat is open.";
        } else if (status === 'rejected') {
            application.lastMessage = "Application Rejected.";
        }

        await application.save();
        res.json(application);

    } catch (error) {
        console.error("Update Status Error:", error);
        res.status(500).json({ message: 'Update failed' });
    }
};

// @desc    Get Applications for logged-in user
// @route   GET /api/applications
// @access  Private
const getApplications = async (req, res) => {
    try {
        let query = {};
        const user = req.user;

        if (user.role === 'employer' || user.role === 'recruiter') {
            // Find apps where this user is the employer
            query = { employer: user._id };
        } else {
            // Find apps where this user is the worker
            // First find the worker profile ID
            const workerProfile = await WorkerProfile.findOne({ user: user._id });
            if (!workerProfile) return res.json([]);
            query = { worker: workerProfile._id };
        }

        const applications = await Application.find(query)
            .populate('job', 'title location salaryRange')
            .populate('worker', 'firstName city totalExperience roleProfiles')
            .populate('employer', 'name') // Populate employer User name
            .sort({ updatedAt: -1 });

        res.json(applications);
    } catch (error) {
        console.error("Get Apps Error:", error);
        res.status(500).json({ message: 'Fetch failed' });
    }
};

// @desc    Get Single Application by ID
// @route   GET /api/applications/:id
// @access  Private
const getApplicationById = async (req, res) => {
    try {
        const application = await Application.findById(req.params.id)
            .populate('job', 'title companyName location salaryRange requirements')
            .populate('employer', 'name email industry location phone website') // Added phone and website
            .populate('worker', 'firstName lastName');

        if (!application) {
            return res.status(404).json({ message: 'Application not found' });
        }

        res.json(application);
    } catch (error) {
        console.error("Get Single App Error:", error);
        res.status(500).json({ message: 'Fetch failed' });
    }
};

module.exports = { sendRequest, updateStatus, getApplications, getApplicationById };
