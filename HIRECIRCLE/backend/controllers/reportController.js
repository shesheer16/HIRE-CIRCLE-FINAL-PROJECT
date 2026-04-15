const Report = require('../models/Report');

const createReport = async (req, res) => {
    try {
        const targetType = String(req.body?.targetType || '').trim().toLowerCase();
        const targetId = String(req.body?.targetId || '').trim();
        const reason = String(req.body?.reason || '').trim();

        if (!targetType || !targetId || !reason) {
            return res.status(400).json({ message: 'targetType, targetId, and reason are required' });
        }

        const report = await Report.create({
            reporterId: req.user?._id || null,
            targetType,
            targetId,
            reason,
            status: 'pending',
            metadata: {
                source: 'user_report',
            },
        });

        return res.status(201).json({
            success: true,
            report,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to submit report' });
    }
};

module.exports = {
    createReport,
};
