#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const { runScaleResilienceSimulation } = require('../services/moatScaleSimulationService');

const toInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const main = async () => {
    const targetUsers = toInt(process.env.MOAT_SIM_USERS, 100000);
    const targetJobs = toInt(process.env.MOAT_SIM_JOBS, 20000);
    const targetMonthlyHires = toInt(process.env.MOAT_SIM_MONTHLY_HIRES, 5000);
    const sampledScorePairs = toInt(process.env.MOAT_SIM_PAIRS, 30000);

    const result = await runScaleResilienceSimulation({
        targetUsers,
        targetJobs,
        targetMonthlyHires,
        sampledScorePairs,
    });

    const reportsDir = path.resolve(__dirname, '..', 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });

    const reportPath = path.join(reportsDir, 'moat-scale-simulation.json');
    fs.writeFileSync(reportPath, JSON.stringify({
        ...result,
        params: {
            targetUsers,
            targetJobs,
            targetMonthlyHires,
            sampledScorePairs,
        },
    }, null, 2));

    console.log(JSON.stringify({
        passed: result.passed,
        checks: result.checks,
        scoringPerf: result.scoringPerf,
        reportPath,
    }, null, 2));
};

main().catch((error) => {
    console.warn('[moat-scale-simulation] failed:', error.message);
    process.exit(1);
});
