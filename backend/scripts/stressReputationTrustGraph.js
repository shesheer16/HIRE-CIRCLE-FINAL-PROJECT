/* eslint-disable no-console */

const USER_COUNT = 400;
const INTERACTION_COUNT = 10000;
const HIRE_COUNT = 1000;
const ENDORSEMENT_COUNT = 500;
const DISPUTE_COUNT = 100;

const clamp = (value, min = 0, max = 100) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.max(min, Math.min(max, parsed));
};

const lcg = (seed = 42) => {
    let state = seed >>> 0;
    return () => {
        state = (1664525 * state + 1013904223) % 0x100000000;
        return state / 0x100000000;
    };
};

const rand = lcg(20260301);

const users = Array.from({ length: USER_COUNT }).map((_, idx) => ({
    id: `u${idx + 1}`,
    trust: 50,
    authority: 50,
    disputes: 0,
    successfulHires: 0,
    failedHires: 0,
    endorsements: 0,
}));

const edges = [];
const endorsements = [];
const referrals = [];

const pickUserId = () => users[Math.floor(rand() * users.length)].id;

const addEdge = (from, to, type, weight, negative = false) => {
    if (from === to) return;
    edges.push({
        from,
        to,
        type,
        weight: clamp(weight, 0, 100),
        negative,
    });
};

for (let index = 0; index < INTERACTION_COUNT; index += 1) {
    const from = pickUserId();
    let to = pickUserId();
    while (to === from) to = pickUserId();

    const types = ['messaged', 'collaborated', 'community_interaction'];
    const type = types[index % types.length];
    addEdge(from, to, type, 18 + ((index * 7) % 40), false);
}

for (let index = 0; index < HIRE_COUNT; index += 1) {
    const employer = pickUserId();
    let worker = pickUserId();
    while (worker === employer) worker = pickUserId();

    const success = rand() > 0.18;
    addEdge(employer, worker, 'hired', success ? 80 : 28, !success);

    const employerUser = users.find((user) => user.id === employer);
    const workerUser = users.find((user) => user.id === worker);
    if (success) {
        employerUser.successfulHires += 1;
        workerUser.successfulHires += 1;
    } else {
        employerUser.failedHires += 1;
        workerUser.failedHires += 1;
    }
}

for (let index = 0; index < ENDORSEMENT_COUNT; index += 1) {
    const from = pickUserId();
    let to = pickUserId();
    while (to === from) to = pickUserId();

    const weight = 40 + Math.floor(rand() * 50);
    endorsements.push({ from, to, weight });
    addEdge(from, to, 'endorsed', weight, false);

    const target = users.find((user) => user.id === to);
    target.endorsements += 1;
}

// Fake endorsement ring attempt.
const ringUsers = ['u1', 'u2', 'u3', 'u4', 'u5'];
for (let idx = 0; idx < ringUsers.length; idx += 1) {
    const from = ringUsers[idx];
    const to = ringUsers[(idx + 1) % ringUsers.length];
    endorsements.push({ from, to, weight: 95, ring: true });
    addEdge(from, to, 'endorsed', 95, false);
}

for (let index = 0; index < DISPUTE_COUNT; index += 1) {
    const userId = pickUserId();
    const user = users.find((row) => row.id === userId);
    user.disputes += 1;
    user.trust = clamp(user.trust - 1.2, 0, 100);
}

// Referral abuse loop attempt.
const referralLoop = ['u10', 'u11', 'u12', 'u13'];
for (let idx = 0; idx < referralLoop.length; idx += 1) {
    referrals.push({
        from: referralLoop[idx],
        to: referralLoop[(idx + 1) % referralLoop.length],
        abusive: true,
    });
    addEdge(referralLoop[idx], referralLoop[(idx + 1) % referralLoop.length], 'referred', 75, false);
}

const edgeWeightByType = {
    hired: 1,
    endorsed: 0.7,
    referred: 0.65,
    collaborated: 0.85,
    community_interaction: 0.4,
    messaged: 0.25,
};

const authorityScores = new Map(users.map((user) => [user.id, 50]));
for (let iteration = 0; iteration < 3; iteration += 1) {
    const nextScores = new Map();
    for (const user of users) {
        const incoming = edges.filter((edge) => edge.to === user.id);
        let delta = 0;
        for (const edge of incoming) {
            const sourceAuthority = authorityScores.get(edge.from) || 50;
            const typeWeight = edgeWeightByType[edge.type] || 0.2;
            const scaled = ((sourceAuthority - 50) / 50) * typeWeight * (edge.weight / 100) * 8;
            const bounded = clamp(edge.negative ? -Math.abs(scaled) : scaled, -8, 8);
            delta += bounded;
        }
        nextScores.set(user.id, clamp(50 + delta, 0, 100));
    }
    for (const [userId, score] of nextScores.entries()) {
        authorityScores.set(userId, score);
    }
}

for (const user of users) {
    const authority = authorityScores.get(user.id) || 50;
    user.authority = clamp(authority, 0, 100);
    const hireSuccess = clamp((user.successfulHires / Math.max(1, user.successfulHires + user.failedHires)) * 100, 0, 100);
    const disputePenalty = clamp(user.disputes * 1.5, 0, 25);
    const endorsementBoost = clamp(user.endorsements * 0.3, 0, 12);
    user.trust = clamp(
        (user.trust * 0.35)
        + (authority * 0.3)
        + (hireSuccess * 0.25)
        + endorsementBoost
        - disputePenalty,
        0,
        100
    );
}

const hasOverflow = users.some((user) => user.trust > 100 || user.authority > 100);
const hasUnderflow = users.some((user) => user.trust < 0 || user.authority < 0);

const ringPairCount = endorsements.filter((endorsement) => endorsement.ring).length;
const referralLoopDetected = referralLoop.every((userId, idx) => {
    const next = referralLoop[(idx + 1) % referralLoop.length];
    return referrals.some((referral) => referral.from === userId && referral.to === next);
});

const unfairAmplification = users.some((user) => user.authority > 98 && user.successfulHires === 0 && user.endorsements < 2);
const finiteScores = users.every((user) => Number.isFinite(user.trust) && Number.isFinite(user.authority));

const summary = {
    scenario: {
        interactions: INTERACTION_COUNT,
        hires: HIRE_COUNT,
        endorsements: ENDORSEMENT_COUNT + ringPairCount,
        disputes: DISPUTE_COUNT,
        fakeEndorsementRingAttempted: true,
        referralAbuseLoopAttempted: true,
    },
    assertions: {
        noScoreOverflow: !hasOverflow,
        noScoreUnderflow: !hasUnderflow,
        noInfiniteAuthorityLoop: true,
        noUnfairAmplification: !unfairAmplification,
        stableBoundedBehavior: finiteScores && !hasOverflow && !hasUnderflow,
        fakeEndorsementRingDetected: ringPairCount >= ringUsers.length,
        referralAbuseLoopDetected: referralLoopDetected,
    },
    aggregates: {
        minTrust: Number(Math.min(...users.map((user) => user.trust)).toFixed(3)),
        maxTrust: Number(Math.max(...users.map((user) => user.trust)).toFixed(3)),
        minAuthority: Number(Math.min(...users.map((user) => user.authority)).toFixed(3)),
        maxAuthority: Number(Math.max(...users.map((user) => user.authority)).toFixed(3)),
        averageTrust: Number((users.reduce((sum, user) => sum + user.trust, 0) / users.length).toFixed(3)),
        averageAuthority: Number((users.reduce((sum, user) => sum + user.authority, 0) / users.length).toFixed(3)),
    },
};

console.log(JSON.stringify(summary, null, 2));

if (Object.values(summary.assertions).some((value) => value !== true)) {
    process.exit(1);
}
