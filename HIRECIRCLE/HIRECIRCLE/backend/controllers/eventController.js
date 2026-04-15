const AnalyticsEvent = require('../models/AnalyticsEvent');
const { recordFromAnalyticsEvent } = require('../services/matchMetricsService');
const { recordFeatureUsage } = require('../services/monetizationIntelligenceService');

// @desc Track a single platform event
// @route POST /api/analytics/track
// @access Private
const trackEvent = async (req, res) => {
    try {
        const { eventName, metadata } = req.body;

        if (!eventName) {
            return res.status(400).json({ message: 'Event Name is required' });
        }

        await AnalyticsEvent.create({
            user: req.user._id,
            eventName,
            metadata: metadata || {}
        });

        setImmediate(async () => {
            try {
                await recordFeatureUsage({
                    userId: req.user._id,
                    featureKey: `event_${String(eventName).toLowerCase()}`,
                    metadata: metadata || {},
                });
            } catch (_error) {
                // Non-blocking instrumentation.
            }
        });

        setImmediate(async () => {
            try {
                await recordFromAnalyticsEvent({
                    eventName,
                    userId: req.user?._id,
                    metadata: metadata || {},
                });
            } catch (metricError) {
                console.warn('Match metric collection failed:', metricError.message);
            }
        });

        // Fire and forget, don't necessarily need to return the doc
        res.status(200).json({ success: true });
    } catch (error) {
        console.warn("Track Event Error:", error);
        res.status(500).json({ message: "Failed to track event" });
    }
};

module.exports = { trackEvent };
