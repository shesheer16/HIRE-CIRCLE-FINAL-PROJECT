
// =================================================================
// 🧠 BLUE-COLLAR LOGIC v7.0 - ALGORITHM HELPERS
// =================================================================

// CONFIGURATION PARAMETERS
const CONFIG = {
    // Dimension weights
    W_SALARY: 0.40,
    W_SKILLS: 0.33,
    W_EXPERIENCE: 0.27,

    // Threshold tolerances
    SALARY_ACCEPTABLE_SHORTFALL: 0.15,
    EXPERIENCE_ACCEPTABLE_SHORTFALL: 0.35,
    SKILLS_ACCEPTABLE_MATCH: 0.50, // Relaxed from 0.75

    // Sigmoid sharpness
    SALARY_SHARPNESS: 12,
    EXPERIENCE_SHARPNESS: 6,
    SKILLS_SHARPNESS: 6, // Relaxed from 8

    // Composite parameters
    FLOOR_THRESHOLD: 0.40,
    FLOOR_PENALTY: 0.50,
    DISPLAY_THRESHOLD: 0.62,
    HIGH_VERIFICATION_THRESHOLD: 0.75,
    QUALITY_HARD_GATE: 0.65,
    QUALITY_SOFT_PENALTY: 0.80,
    SOFT_BONUS_MAX: 0.20
};

// PHASE 2: HARD GATES
const hardGates = (job, worker, roleData) => {
    // 1. Shift Gate
    if (job.shift && job.shift !== 'Flexible' && worker.preferredShift && worker.preferredShift !== 'Flexible') {
        if (job.shift !== worker.preferredShift) return false;
    }

    // 2. Salary Ceiling Gate (Worker Expectation > Job Max + 15%)
    if (job.maxSalary && roleData.expectedSalary) {
        if (roleData.expectedSalary > (job.maxSalary * 1.15)) return false;
    }

    // 3. Mandatory Licenses
    if (job.mandatoryLicenses && job.mandatoryLicenses.length > 0) {
        const workerLicenses = worker.licenses || [];
        const hasLicenses = job.mandatoryLicenses.every(req =>
            workerLicenses.some(wl => wl.toLowerCase().includes(req.toLowerCase()))
        );
        if (!hasLicenses) return false;
    }

    // 4. Location Gate (String Match Only - per user requirement)
    if (job.location && worker.city) {
        if (job.location.toLowerCase().trim() !== worker.city.toLowerCase().trim()) return false;
    }

    return true; // Passed all gates
};

// PHASE 3: QUALITY FACTOR
const calculateQualityFactor = (job, worker) => {
    // Simple quality heuristic: filled fields count
    // This is simplified. In a real system, we'd check actual field validity.
    // For now, if they passed the Hard Gates and have a role, we assume basic quality.

    // Check for "laziness" - e.g. very short descriptions or missing basic info
    // Logic: If < 65% complete (simulated), Reject.
    // We already filter extensively in the query, so we assume valid workers are > 65%.
    return 1.0;
};

// PHASE 5: DIMENSION SCORING

const salaryScore = (seekerExpectation, jobOfferMax) => {
    if (!seekerExpectation) return 1.0; // Assume fit if not specified
    if (!jobOfferMax) return 1.0;

    if (jobOfferMax >= seekerExpectation) {
        const excessRatio = (jobOfferMax / seekerExpectation) - 1.0;
        return 0.95 + 0.05 * (1 - Math.exp(-2 * excessRatio));
    } else {
        const shortfall = (seekerExpectation - jobOfferMax) / seekerExpectation;
        const x = CONFIG.SALARY_SHARPNESS * (CONFIG.SALARY_ACCEPTABLE_SHORTFALL - shortfall);
        return 1 / (1 + Math.exp(-x));
    }
};

const experienceScore = (seekerExp, requiredExp) => {
    // Handling unstructured text in DB (cleaning required in Controller)
    const sExp = Number(seekerExp) || 0;
    const rExp = Number(requiredExp) || 0;

    if (sExp >= rExp) {
        const excessRatio = (sExp / Math.max(rExp, 1)) - 1.0;
        if (excessRatio > 2.0) return 0.85; // Overqualified
        return Math.min(1.0, 0.95 + 0.05 * excessRatio);
    } else {
        const shortfall = (rExp - sExp) / rExp;
        const x = CONFIG.EXPERIENCE_SHARPNESS * (CONFIG.EXPERIENCE_ACCEPTABLE_SHORTFALL - shortfall);
        return 1 / (1 + Math.exp(-x));
    }
};

const skillsScore = (seekerSkills, requiredSkills) => {
    if (!requiredSkills || requiredSkills.length === 0) return 1.0;
    const sSkills = seekerSkills || [];

    // Normalization
    const sSet = new Set(sSkills.map(s => s.toLowerCase().trim()));
    const rSet = new Set(requiredSkills.map(s => s.toLowerCase().trim()));

    let matched = 0;
    rSet.forEach(req => {
        if (sSet.has(req)) matched++;
    });

    const matchRate = matched / rSet.size;
    const x = CONFIG.SKILLS_SHARPNESS * (matchRate - CONFIG.SKILLS_ACCEPTABLE_MATCH);
    return 1 / (1 + Math.exp(-x));
};

// PHASE 6: CRITICAL COMPOSITE (Geometric Mean)
const criticalComposite = (sal, exp, skl) => {
    const EPSILON = 1e-6;
    const logGeo = (
        CONFIG.W_SALARY * Math.log(Math.max(sal, EPSILON)) +
        CONFIG.W_SKILLS * Math.log(Math.max(skl, EPSILON)) +
        CONFIG.W_EXPERIENCE * Math.log(Math.max(exp, EPSILON))
    );
    const geometricMean = Math.exp(logGeo);

    // Floor Rule
    const worst = Math.min(sal, skl, exp);
    if (worst < CONFIG.FLOOR_THRESHOLD) {
        return worst * CONFIG.FLOOR_PENALTY;
    }
    return geometricMean;
};

// PHASE 7: SOFT BONUSES
const calculateSoftBonus = (job, worker) => {
    let bonus = 0.0;

    // Verification Bonus
    if (worker.verificationStatus?.isVerified) bonus += 0.02;

    // Shift Alignment Bonus
    if (job.shift && worker.preferredShift && job.shift === worker.preferredShift) {
        bonus += 0.04;
    }

    return Math.min(bonus, CONFIG.CONFIG?.SOFT_BONUS_MAX || 0.20);
};

module.exports = {
    hardGates,
    salaryScore,
    experienceScore,
    skillsScore,
    criticalComposite,
    calculateSoftBonus,
    CONFIG
};
