require('dotenv').config();

const connectDB = require('../config/db');
const InterviewProcessingJob = require('../models/InterviewProcessingJob');
const { setSystemFlag } = require('../services/systemFlagService');
const { publishMetric } = require('../services/metricsService');
const { startOfUtcDay } = require('../utils/timezone');

const inputTokensPerInterview = Number.parseFloat(process.env.INTERVIEW_AVG_INPUT_TOKENS || '2200');
const outputTokensPerInterview = Number.parseFloat(process.env.INTERVIEW_AVG_OUTPUT_TOKENS || '300');
const inputCostPer1kTokensUsd = Number.parseFloat(process.env.INTERVIEW_GEMINI_INPUT_COST_PER_1K_USD || '0.00035');
const outputCostPer1kTokensUsd = Number.parseFloat(process.env.INTERVIEW_GEMINI_OUTPUT_COST_PER_1K_USD || '0.00053');
const maxDailyCostUsd = Number.parseFloat(process.env.INTERVIEW_DAILY_COST_THRESHOLD_USD || '35');
const monitorFlagTtlSeconds = Number.parseInt(process.env.INTERVIEW_UPLOAD_DISABLE_FLAG_TTL_SECONDS || String(2 * 60 * 60), 10);

const estimateCostUsd = (interviewCount) => {
    const totalInputTokens = interviewCount * inputTokensPerInterview;
    const totalOutputTokens = interviewCount * outputTokensPerInterview;
    const inputCost = (totalInputTokens / 1000) * inputCostPer1kTokensUsd;
    const outputCost = (totalOutputTokens / 1000) * outputCostPer1kTokensUsd;
    return inputCost + outputCost;
};

const runCostMonitor = async () => {
    const startOfDay = startOfUtcDay(new Date());

    const processedToday = await InterviewProcessingJob.countDocuments({
        createdAt: { $gte: startOfDay },
        status: { $in: ['completed', 'failed', 'processing', 'pending'] },
    });
    const estimatedCostUsd = estimateCostUsd(processedToday);

    const shouldDisableUploads = estimatedCostUsd > maxDailyCostUsd;
    await setSystemFlag('INTERVIEW_UPLOADS_DISABLED', shouldDisableUploads, monitorFlagTtlSeconds);

    await publishMetric({
        metricName: 'InterviewDailyCount',
        value: processedToday,
        role: 'system',
        correlationId: 'cost-monitor',
    });

    console.log(JSON.stringify({
        event: 'interview_cost_monitor',
        processedToday,
        estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
        thresholdUsd: maxDailyCostUsd,
        uploadsDisabled: shouldDisableUploads,
        correlationId: 'cost-monitor',
    }));
};

const main = async () => {
    await connectDB();
    await runCostMonitor();
    process.exit(0);
};

main().catch((error) => {
    console.warn('Interview cost monitor failed:', error.message);
    process.exit(1);
});
