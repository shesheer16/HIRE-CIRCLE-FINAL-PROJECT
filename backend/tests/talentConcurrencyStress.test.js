const { sortScoredMatches } = require('../match/matchEngineV2');

describe('talent concurrency stress', () => {
  it('uses stable sort tie-breaker when scores are equal', () => {
    const rows = [
      { finalScore: 0.8, trustTieBreaker: 0.5, profileCompleteness: 0.9, verificationStatus: true, lastActive: new Date('2026-01-01') },
      { finalScore: 0.8, trustTieBreaker: 0.4, profileCompleteness: 0.8, verificationStatus: false, lastActive: new Date('2026-01-02') },
    ];

    const sorted = [...rows].sort(sortScoredMatches);
    expect(sorted[0].trustTieBreaker).toBeGreaterThanOrEqual(sorted[1].trustTieBreaker);
  });
});
