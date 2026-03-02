const {
    HARD_GATE_REASONS,
    mapTier,
    evaluateRoleAgainstJob,
    rankJobsForWorker,
    sortScoredMatches,
} = require('../match/matchEngineV2');

describe('matchEngineV2', () => {
    const baseJob = {
        _id: 'job-1',
        title: 'Delivery Driver',
        location: 'Hyderabad',
        requirements: ['Driving'],
        maxSalary: 25000,
        shift: 'Flexible',
        mandatoryLicenses: [],
    };

    const baseWorker = {
        _id: 'worker-1',
        firstName: 'Lokesh',
        city: 'Hyderabad',
        interviewVerified: true,
        preferredShift: 'Flexible',
        licenses: ['Commercial'],
        roleProfiles: [],
        updatedAt: new Date('2026-01-01T00:00:00Z'),
    };

    const baseUser = {
        _id: 'user-1',
        isVerified: true,
        hasCompletedProfile: true,
    };

    const baseRole = {
        roleName: 'Driver',
        experienceInRole: 4,
        expectedSalary: 22000,
        skills: ['Driving', 'Route Planning'],
    };

    it('rejects on missing mandatory certification', () => {
        const evaluation = evaluateRoleAgainstJob({
            job: { ...baseJob, mandatoryLicenses: ['Heavy Vehicle'] },
            worker: { ...baseWorker, licenses: ['LMV'] },
            workerUser: baseUser,
            roleData: baseRole,
        });

        expect(evaluation.accepted).toBe(false);
        expect(evaluation.rejectReason).toBe(HARD_GATE_REASONS.CERTIFICATION_MISSING);
    });

    it('rejects on shift mismatch hard gate', () => {
        const evaluation = evaluateRoleAgainstJob({
            job: { ...baseJob, shift: 'Night' },
            worker: { ...baseWorker, preferredShift: 'Day' },
            workerUser: baseUser,
            roleData: baseRole,
        });

        expect(evaluation.accepted).toBe(false);
        expect(evaluation.rejectReason).toBe(HARD_GATE_REASONS.SHIFT_MISMATCH);
    });

    it('computes multiplicative score and explainability', () => {
        const evaluation = evaluateRoleAgainstJob({
            job: baseJob,
            worker: baseWorker,
            workerUser: baseUser,
            roleData: baseRole,
        });

        expect(evaluation.accepted).toBe(true);
        expect(evaluation.finalScore).toBeGreaterThan(0);
        expect(evaluation.explainability.skillScore).toBeCloseTo(evaluation.skillScore);
        expect(evaluation.explainability.finalScore).toBeCloseTo(evaluation.finalScore);
        expect(evaluation.tier).toBe(mapTier(evaluation.finalScore));
    });

    it('maps tiers correctly', () => {
        expect(mapTier(0.90)).toBe('STRONG');
        expect(mapTier(0.75)).toBe('GOOD');
        expect(mapTier(0.63)).toBe('POSSIBLE');
        expect(mapTier(0.40)).toBe('REJECT');
    });

    it('handles null critical fields safely', () => {
        const evaluation = evaluateRoleAgainstJob({
            job: { ...baseJob, title: '' },
            worker: baseWorker,
            workerUser: baseUser,
            roleData: baseRole,
        });

        expect(evaluation.accepted).toBe(false);
        expect(evaluation.rejectReason).toBe(HARD_GATE_REASONS.NULL_CRITICAL_FIELDS);
    });

    it('sorts ties by verification/profile/lastActive/distance', () => {
        const rows = [
            {
                finalScore: 0.8,
                verificationStatus: false,
                profileCompleteness: 0.8,
                lastActive: new Date('2026-01-01T00:00:00Z'),
                distanceKm: 2,
            },
            {
                finalScore: 0.8,
                verificationStatus: true,
                profileCompleteness: 0.8,
                lastActive: new Date('2026-01-01T00:00:00Z'),
                distanceKm: 5,
            },
        ];

        rows.sort(sortScoredMatches);
        expect(rows[0].verificationStatus).toBe(true);
    });

    it('uses trust metrics as tie-break only when scores are equal', () => {
        const rows = [
            {
                finalScore: 0.8,
                verificationStatus: true,
                profileCompleteness: 0.8,
                lastActive: new Date('2026-01-01T00:00:00Z'),
                distanceKm: 2,
                trustMetrics: {
                    trustScore: 60,
                    hireSuccessScore: 55,
                    responseScore: 50,
                },
            },
            {
                finalScore: 0.8,
                verificationStatus: true,
                profileCompleteness: 0.8,
                lastActive: new Date('2026-01-01T00:00:00Z'),
                distanceKm: 2,
                trustMetrics: {
                    trustScore: 90,
                    hireSuccessScore: 84,
                    responseScore: 88,
                },
            },
        ];

        rows.sort(sortScoredMatches);
        expect(rows[0].trustMetrics.trustScore).toBe(90);
    });

    it('returns only top 20 ranked jobs', () => {
        const jobs = Array.from({ length: 25 }).map((_, index) => ({
            ...baseJob,
            _id: `job-${index}`,
            title: 'Driver',
            requirements: ['Driving'],
            maxSalary: 25000 + index,
        }));

        const worker = {
            ...baseWorker,
            roleProfiles: [baseRole],
        };

        const ranked = rankJobsForWorker({
            worker,
            workerUser: baseUser,
            jobs,
            maxResults: 20,
        });

        expect(ranked.matches.length).toBeLessThanOrEqual(20);
    });

    it('bounds reliability multiplier and does not rescue weak base matches', () => {
        const evaluation = evaluateRoleAgainstJob({
            job: {
                ...baseJob,
                title: 'Driver',
                requirements: ['Driving', 'Fleet Management', 'Dispatch Control'],
            },
            worker: {
                ...baseWorker,
                roleProfiles: [baseRole],
            },
            workerUser: baseUser,
            roleData: {
                ...baseRole,
                skills: ['Driving'],
                experienceInRole: 1,
            },
            scoringContext: {
                workerReliabilityScore: 1.1,
                employerStabilityScore: 1.1,
                shiftConsistencyScore: 1.1,
                employerQualityScore: 1.1,
            },
        });

        expect(evaluation.reliabilityMultiplier).toBeLessThanOrEqual(1.15);
        expect(evaluation.baseScore).toBeLessThan(0.62);
        expect(evaluation.accepted).toBe(false);
        expect(evaluation.tier).toBe('REJECT');
    });

    it('allows low-density distance tolerance via scoring context', () => {
        const evaluation = evaluateRoleAgainstJob({
            job: {
                ...baseJob,
                title: 'Driver',
                location: 'Secunderabad',
            },
            worker: {
                ...baseWorker,
                city: 'Hyderabad',
                roleProfiles: [baseRole],
            },
            workerUser: baseUser,
            roleData: baseRole,
            scoringContext: {
                distanceToleranceEnabled: true,
                distanceFallbackScore: 0.72,
            },
        });

        expect(evaluation.distanceScore).toBeCloseTo(0.72);
        expect(evaluation.rejectReason).not.toBe(HARD_GATE_REASONS.COMMUTE_OUTSIDE_RADIUS);
    });

    it('applies verified priority boost only when feature flag is enabled', () => {
        const worker = {
            ...baseWorker,
            interviewVerified: true,
            roleProfiles: [baseRole],
            interviewIntelligence: {
                profileQualityScore: 0.9,
                communicationClarityScore: 0.9,
                salaryOutlierFlag: false,
            },
        };

        const withoutFlag = evaluateRoleAgainstJob({
            job: baseJob,
            worker,
            workerUser: baseUser,
            roleData: baseRole,
            scoringContext: {
                featureVerifiedPriorityEnabled: false,
                profileQualityScore: 0.9,
            },
        });

        const withFlag = evaluateRoleAgainstJob({
            job: baseJob,
            worker,
            workerUser: baseUser,
            roleData: baseRole,
            scoringContext: {
                featureVerifiedPriorityEnabled: true,
                profileQualityScore: 0.9,
            },
        });

        expect(withFlag.explainability.verifiedPriorityMultiplier).toBeGreaterThanOrEqual(1.05);
        expect(withFlag.explainability.verifiedPriorityMultiplier).toBeLessThanOrEqual(1.08);
        expect(withFlag.finalScore).toBeGreaterThan(withoutFlag.finalScore);
    });

    it('caps explainability reasons to 3 and prioritizes trust markers', () => {
        const evaluation = evaluateRoleAgainstJob({
            job: baseJob,
            worker: {
                ...baseWorker,
                interviewVerified: true,
                roleProfiles: [baseRole],
                interviewIntelligence: {
                    profileQualityScore: 0.85,
                    communicationClarityScore: 0.82,
                    salaryOutlierFlag: false,
                },
            },
            workerUser: baseUser,
            roleData: baseRole,
            scoringContext: {
                profileQualityScore: 0.85,
                communicationClarityScore: 0.82,
                salaryOutlierFlag: false,
            },
        });

        expect(evaluation.explainability.topReasons.length).toBeLessThanOrEqual(3);
        expect(evaluation.explainability.topReasons).toContain('Verified profile');
        expect(evaluation.explainability.topReasons).toContain('Strong communication');
        expect(evaluation.explainability.topReasons).toContain('Salary aligned with market');
    });
});
