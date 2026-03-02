const { runScaleResilienceSimulation } = require('../services/moatScaleSimulationService');

describe('moatScaleSimulationService', () => {
    it('runs simulation and returns resilience checks', async () => {
        const result = await runScaleResilienceSimulation({
            targetUsers: 100000,
            targetJobs: 20000,
            targetMonthlyHires: 5000,
            sampledScorePairs: 1200,
        });

        expect(result).toEqual(expect.objectContaining({
            simulatedScale: expect.objectContaining({
                users: 100000,
                jobs: 20000,
                hiresPerMonth: 5000,
            }),
            scoringPerf: expect.objectContaining({
                avgMatchLatencyMs: expect.any(Number),
                p95MatchLatencyMs: expect.any(Number),
                p99MatchLatencyMs: expect.any(Number),
            }),
            checks: expect.objectContaining({
                trustGraphNotSlow: expect.any(Boolean),
                rankingNotDegraded: expect.any(Boolean),
                queryExplosionPrevented: expect.any(Boolean),
            }),
            passed: expect.any(Boolean),
        }));
    });
});
