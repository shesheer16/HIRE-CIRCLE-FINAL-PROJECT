const BetaFeedback = require('../models/BetaFeedback');
const mongoose = require('mongoose');

// @desc Submit feedback from the beta testing panel
// @route POST /api/feedback
// @access Private
const submitFeedback = async (req, res) => {
    try {
        const { type, message, screenshotUrl } = req.body;

        if (!type || !message) {
            return res.status(400).json({ message: 'Type and message are required' });
        }

        const feedback = await BetaFeedback.create({
            user: req.user._id,
            type,
            message,
            screenshotUrl
        });

        res.status(201).json({ success: true, data: feedback });
    } catch (error) {
        console.warn("Submit Feedback Error:", error);
        res.status(500).json({ message: "Failed to submit feedback" });
    }
};

// @desc Get all feedback for admin dashboard
// @route GET /api/admin/feedback
// @access Private (Admin)
const getFeedback = async (req, res) => {
    try {
        const hardCap = 5000;
        const requestedLimit = Number.parseInt(req.query.limit || '100', 10);
        const safeLimit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 100, 1), hardCap);
        const cursor = req.query.cursor ? String(req.query.cursor) : null;

        if (requestedLimit > hardCap) {
            console.warn(`[admin-feedback] requested limit ${requestedLimit} exceeds hard cap ${hardCap}, capping result size`);
        }

        const query = {};
        if (cursor) {
            if (!mongoose.Types.ObjectId.isValid(cursor)) {
                return res.status(400).json({ message: 'Invalid cursor' });
            }
            query._id = { $lt: new mongoose.Types.ObjectId(cursor) };
        }

        const feedbackList = await BetaFeedback.find(query)
            .populate('user', 'name email role')
            .sort({ _id: -1 })
            .limit(safeLimit + 1);

        const hasMore = feedbackList.length > safeLimit;
        const rows = hasMore ? feedbackList.slice(0, safeLimit) : feedbackList;
        const nextCursor = hasMore ? String(rows[rows.length - 1]._id) : null;

        res.json({
            success: true,
            count: rows.length,
            data: rows,
            hasMore,
            nextCursor,
        });
    } catch (error) {
        console.warn("Get Feedback Error:", error);
        res.status(500).json({ message: "Failed to load feedback" });
    }
};

module.exports = { submitFeedback, getFeedback };
