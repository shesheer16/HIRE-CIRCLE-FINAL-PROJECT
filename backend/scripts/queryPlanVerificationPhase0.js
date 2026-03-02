require('dotenv').config();

const mongoose = require('mongoose');
const Job = require('../models/Job');
const MatchPerformanceMetric = require('../models/MatchPerformanceMetric');
const RevenueEvent = require('../models/RevenueEvent');

const extractStages = (plan, stages = []) => {
    if (!plan || typeof plan !== 'object') return stages;
    if (plan.stage) stages.push(plan.stage);
    Object.keys(plan).forEach((key) => {
        const value = plan[key];
        if (Array.isArray(value)) {
            value.forEach((item) => extractStages(item, stages));
        } else if (value && typeof value === 'object') {
            extractStages(value, stages);
        }
    });
    return stages;
};

const summarizeExplain = (label, explain) => {
    const stats = explain.executionStats || {};
    const planner = explain.queryPlanner || {};
    const winningPlan = planner.winningPlan || {};
    const stages = Array.from(new Set(extractStages(winningPlan, [])));
    const hasCollectionScan = stages.includes('COLLSCAN');

    return {
        label,
        stages,
        hasCollectionScan,
        executionTimeMs: Number(stats.executionTimeMillis || 0),
        totalKeysExamined: Number(stats.totalKeysExamined || 0),
        totalDocsExamined: Number(stats.totalDocsExamined || 0),
        nReturned: Number(stats.nReturned || 0),
    };
};

const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is not set');
    }

    await mongoose.connect(process.env.MONGO_URI);

    try {
        const now = new Date();
        const from30d = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

        const [recommendedExplain, matchQualityExplain, revenueLoopExplain] = await Promise.all([
            Job.find({
                isOpen: true,
                status: 'active',
            })
                .sort({ createdAt: -1 })
                .limit(5000)
                .explain('executionStats'),
            MatchPerformanceMetric.find({
                timestamp: { $gte: from30d, $lte: now },
            })
                .select('eventName matchProbability matchTier city roleCluster timestamp')
                .explain('executionStats'),
            RevenueEvent.find({
                city: { $in: ['Hyderabad', 'hyderabad', 'HYDERABAD'] },
                status: 'succeeded',
                settledAt: { $gte: from30d, $lte: now },
            })
                .explain('executionStats'),
        ]);

        const report = [
            summarizeExplain('/api/jobs/recommended (primary query)', recommendedExplain),
            summarizeExplain('/api/analytics/match-quality-overview (primary query)', matchQualityExplain),
            summarizeExplain('/api/analytics/revenue-loops (primary query)', revenueLoopExplain),
        ];

        console.log(JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));
    } finally {
        await mongoose.connection.close();
    }
};

run().catch((error) => {
    console.warn('queryPlanVerificationPhase0 failed:', error.message);
    process.exit(1);
});
