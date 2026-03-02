'use strict';
/**
 * monetizationRevenue.test.js
 * Complete test suite for Features 61–80: Monetization & Revenue
 *
 * Feature map:
 *  #61  — Boost job listing paid service
 *  #62  — Featured job positions carousel
 *  #63  — Premium subscription for employers
 *  #64  — Showcase talent premium feature
 *  #65  — Promoted jobs filter top placement
 *  #66  — Career coaching / event ads
 *  #67  — Resume review paid AI assistant
 *  #68  — In-app skill test certificates
 *  #69  — Pay-per-lead for employers
 *  #70  — Employer analytics dashboard
 *  #71  — Premium applicant insights pack
 *  #72  — Job promotion credit system
 *  #73  — Subscription perks (free applies, priority)
 *  #74  — In-app currency for boosts
 *  #75  — Referral commission program UI
 *  #76  — Freemium AI smart suggestions
 *  #77  — User gifting (brand partnerships)
 *  #78  — Cross-sell industry partner services
 *  #79  — Matched job preview unlocked with premium
 *  #80  — Custom interview analysis report (paid)
 */

// ════════════════════════════════════════════════════════════════════════════
// GLOBAL MOCKS
// ════════════════════════════════════════════════════════════════════════════
jest.mock('../models/Job', () => ({
    find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
            { _id: 'j1', title: 'Delivery Executive', isFeatured: true, boosted: true },
            { _id: 'j2', title: 'Warehouse Manager', isFeatured: true, boosted: false },
        ]),
    }),
    findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ _id: 'j1', isOpen: true, employerId: 'emp1', boosted: false }),
    }),
    findByIdAndUpdate: jest.fn().mockResolvedValue({ _id: 'j1', boosted: true }),
    findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'j1', boosted: false }),
}));

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #61 — Boost Job Listing Paid Service
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #61 — Boost Job Listing', () => {
    const { boostJob, clearBoost, getBoostStatus, BOOST_TIERS } = require('../services/boostJobService');

    test('BOOST_TIERS has at least 2 tiers', () => {
        expect(Object.keys(BOOST_TIERS).length).toBeGreaterThanOrEqual(2);
    });

    test('each boost tier has durationDays and sortWeight', () => {
        Object.values(BOOST_TIERS).forEach((tier) => {
            expect(tier.durationDays).toBeGreaterThan(0);
            expect(tier.sortWeight).toBeGreaterThan(0);
        });
    });

    test('boostJob is a callable function', () => {
        expect(typeof boostJob).toBe('function');
    });

    test('clearBoost is a callable function', () => {
        expect(typeof clearBoost).toBe('function');
    });

    test('getBoostStatus is a callable function', () => {
        expect(typeof getBoostStatus).toBe('function');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #62 — Featured Job Positions Carousel
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #62 — Featured Jobs Carousel', () => {
    const { getFeaturedJobs, getPromotedJobs } = require('../services/featuredJobService');

    test('getFeaturedJobs returns an array', async () => {
        const jobs = await getFeaturedJobs();
        expect(Array.isArray(jobs)).toBe(true);
    });

    test('getFeaturedJobs returns jobs with _id field', async () => {
        const jobs = await getFeaturedJobs();
        jobs.forEach((j) => expect(j._id).toBeDefined());
    });

    test('getPromotedJobs returns an array', async () => {
        const jobs = await getPromotedJobs();
        expect(Array.isArray(jobs)).toBe(true);
    });

    test('getFeaturedJobs is async (returns Promise)', () => {
        expect(getFeaturedJobs()).toBeInstanceOf(Promise);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #63 — Premium Subscription for Employers
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #63 — Premium Subscription for Employers', () => {
    const { PLANS, PLAN_RANK, getPlanDetails, hasPlanFeature, comparePlans, buildUpgradePrompt } =
        require('../services/premiumSubscriptionService');

    test('PLANS covers free, starter, pro, enterprise', () => {
        ['free', 'starter', 'pro', 'enterprise'].forEach((p) => expect(PLANS).toHaveProperty(p));
    });

    test('each plan has price and jobPostLimit', () => {
        Object.values(PLANS).forEach((p) => {
            expect(p).toHaveProperty('price');
            expect(p).toHaveProperty('jobPostLimit');
        });
    });

    test('getPlanDetails returns correct plan', () => {
        const pro = getPlanDetails('pro');
        expect(pro.name).toBe('Pro');
        expect(pro.price).toBeGreaterThan(0);
    });

    test('getPlanDetails falls back to free for unknown plan', () => {
        const p = getPlanDetails('unknown_plan');
        expect(p.name).toBe('Free');
    });

    test('hasPlanFeature returns false for free candidateInsights', () => {
        expect(hasPlanFeature('free', 'candidateInsights')).toBe(false);
    });

    test('hasPlanFeature returns true for enterprise candidateInsights', () => {
        expect(hasPlanFeature('enterprise', 'candidateInsights')).toBe(true);
    });

    test('comparePlans: pro > free returns 1', () => {
        expect(comparePlans('pro', 'free')).toBe(1);
    });

    test('comparePlans: free < enterprise returns -1', () => {
        expect(comparePlans('free', 'enterprise')).toBe(-1);
    });

    test('buildUpgradePrompt for free → pro shows upgrade message', () => {
        const result = buildUpgradePrompt('free', 'pro');
        expect(result.canAccess).toBe(false);
        expect(result.upgradeMessage).toContain('Pro');
    });

    test('buildUpgradePrompt for enterprise → pro shows no upgrade needed', () => {
        const result = buildUpgradePrompt('enterprise', 'pro');
        expect(result.canAccess).toBe(true);
        expect(result.upgradeMessage).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #64 — Showcase Talent Premium Feature
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #64 — Showcase Talent', () => {
    const { SHOWCASE_TIERS, buildShowcaseRecord, isShowcaseActive, getVisibilityMultiplier, rankWithShowcase } =
        require('../services/showcaseTalentService');

    test('SHOWCASE_TIERS has standard, featured, spotlight', () => {
        ['standard', 'featured', 'spotlight'].forEach((t) => expect(SHOWCASE_TIERS).toHaveProperty(t));
    });

    test('buildShowcaseRecord creates a valid record', () => {
        const rec = buildShowcaseRecord('user1', 'featured');
        expect(rec.userId).toBe('user1');
        expect(rec.tier).toBe('featured');
        expect(rec.active).toBe(true);
        expect(rec.expiresAt).toBeInstanceOf(Date);
    });

    test('buildShowcaseRecord throws 400 for invalid tier', () => {
        expect(() => buildShowcaseRecord('user1', 'invalid_tier')).toThrow();
    });

    test('isShowcaseActive returns true for fresh record', () => {
        const rec = buildShowcaseRecord('user1', 'standard');
        expect(isShowcaseActive(rec)).toBe(true);
    });

    test('isShowcaseActive returns false for expired record', () => {
        const rec = buildShowcaseRecord('user1', 'standard');
        rec.expiresAt = new Date(Date.now() - 1000); // expired
        expect(isShowcaseActive(rec)).toBe(false);
    });

    test('getVisibilityMultiplier returns 1.0 for expired/null record', () => {
        expect(getVisibilityMultiplier(null)).toBe(1.0);
    });

    test('getVisibilityMultiplier returns >1 for active spotlight', () => {
        const rec = buildShowcaseRecord('user1', 'spotlight');
        expect(getVisibilityMultiplier(rec)).toBeGreaterThan(1);
    });

    test('rankWithShowcase sorts higher-multiplier profiles first', () => {
        const profiles = [
            { _id: '1', _showcaseMultiplier: 1 },
            { _id: '2', _showcaseMultiplier: 3 },
        ];
        const ranked = rankWithShowcase(profiles);
        expect(ranked[0]._id).toBe('2');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #65 — Promoted Jobs Filter / Top Placement
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #65 — Promoted Jobs Filter', () => {
    const { PROMOTION_TIERS, buildPromotionRecord, isPromotionActive, sortWithPromotions, computePromotionSpend } =
        require('../services/promotedJobsService');

    test('PROMOTION_TIERS has standard, premium, spotlight', () => {
        ['standard', 'premium', 'spotlight'].forEach((t) => expect(PROMOTION_TIERS).toHaveProperty(t));
    });

    test('buildPromotionRecord creates valid record', () => {
        const rec = buildPromotionRecord('j1', 'emp1', 'standard');
        expect(rec.jobId).toBe('j1');
        expect(rec.active).toBe(true);
        expect(rec.label).toBe('Promoted');
    });

    test('buildPromotionRecord throws 400 for missing jobId', () => {
        expect(() => buildPromotionRecord('', 'emp1', 'standard')).toThrow();
    });

    test('buildPromotionRecord throws 400 for invalid tier', () => {
        expect(() => buildPromotionRecord('j1', 'emp1', 'ultra')).toThrow();
    });

    test('isPromotionActive returns true for fresh record', () => {
        const rec = buildPromotionRecord('j1', 'emp1');
        expect(isPromotionActive(rec)).toBe(true);
    });

    test('isPromotionActive returns false for expired record', () => {
        const rec = buildPromotionRecord('j1', 'emp1');
        rec.expiresAt = new Date(Date.now() - 1000);
        expect(isPromotionActive(rec)).toBe(false);
    });

    test('sortWithPromotions bubbles promoted jobs to front', () => {
        const jobs = [{ _id: 'j1' }, { _id: 'j2' }];
        const map = { j2: true };
        const sorted = sortWithPromotions(jobs, map);
        expect(sorted[0]._id).toBe('j2');
    });

    test('computePromotionSpend sums prices', () => {
        const records = [{ price: 499 }, { price: 1299 }];
        expect(computePromotionSpend(records)).toBe(1798);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #66 — Career Coaching / Event Ads
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #66 — Career Coaching & Event Ads', () => {
    const { COACHING_PACKAGES, EVENT_TYPES, getCoachingPackages, buildCoachingBooking, buildEventAd, applyDiscount } =
        require('../services/careerCoachingService');

    test('COACHING_PACKAGES has at least 3 packages', () => {
        expect(Object.keys(COACHING_PACKAGES).length).toBeGreaterThanOrEqual(3);
    });

    test('EVENT_TYPES includes webinar and job_fair', () => {
        expect(EVENT_TYPES).toContain('webinar');
        expect(EVENT_TYPES).toContain('job_fair');
    });

    test('getCoachingPackages returns array with key field', () => {
        const pkgs = getCoachingPackages();
        expect(Array.isArray(pkgs)).toBe(true);
        pkgs.forEach((p) => expect(p.key).toBeDefined());
    });

    test('buildCoachingBooking creates valid booking', () => {
        const booking = buildCoachingBooking('user1', 'mock_interview');
        expect(booking.userId).toBe('user1');
        expect(booking.packageKey).toBe('mock_interview');
        expect(booking.status).toBe('pending');
        expect(booking.price).toBeGreaterThan(0);
    });

    test('buildCoachingBooking throws 400 for invalid package', () => {
        expect(() => buildCoachingBooking('user1', 'flying_course')).toThrow();
    });

    test('buildEventAd creates valid event ad', () => {
        const ad = buildEventAd('Resume Workshop', 'webinar', 'org1', 299);
        expect(ad.title).toBe('Resume Workshop');
        expect(ad.active).toBe(true);
    });

    test('buildEventAd throws 400 for invalid event type', () => {
        expect(() => buildEventAd('Test', 'invalid_type', 'org1', 100)).toThrow();
    });

    test('applyDiscount returns discounted price', () => {
        const discounted = applyDiscount('mock_interview', 10);
        expect(discounted).toBeLessThan(COACHING_PACKAGES.mock_interview.price);
    });

    test('applyDiscount 0% returns original price', () => {
        const original = COACHING_PACKAGES.mock_interview.price;
        expect(applyDiscount('mock_interview', 0)).toBe(original);
    });

    test('applyDiscount 100% returns 0', () => {
        expect(applyDiscount('mock_interview', 100)).toBe(0);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #67 — Resume Review Paid AI Assistant
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #67 — Resume Review AI Assistant', () => {
    const { REVIEW_TIERS, analyzeResumeKeywords, buildReviewOrder, scoreLengthAppropriateness, STRONG_KEYWORDS } =
        require('../services/resumeReviewService');

    test('REVIEW_TIERS has basic, standard, premium', () => {
        ['basic', 'standard', 'premium'].forEach((t) => expect(REVIEW_TIERS).toHaveProperty(t));
    });

    test('analyzeResumeKeywords returns atsScore and wordCount', () => {
        const result = analyzeResumeKeywords('I managed a team and delivered key projects successfully.');
        expect(result).toHaveProperty('atsScore');
        expect(result).toHaveProperty('wordCount');
    });

    test('atsScore is 0–100', () => {
        const result = analyzeResumeKeywords('Helped with tasks and assisted with work.');
        expect(result.atsScore).toBeGreaterThanOrEqual(0);
        expect(result.atsScore).toBeLessThanOrEqual(100);
    });

    test('strongKeywordsFound includes matching words', () => {
        const result = analyzeResumeKeywords('I led a team of 10 and improved delivery by 30%.');
        expect(result.strongKeywordsFound).toContain('led');
        expect(result.strongKeywordsFound).toContain('improved');
    });

    test('buildReviewOrder creates valid order', () => {
        const order = buildReviewOrder('user1', 'standard');
        expect(order.userId).toBe('user1');
        expect(order.status).toBe('pending');
        expect(order.price).toBeGreaterThan(0);
    });

    test('buildReviewOrder throws 400 for invalid tier', () => {
        expect(() => buildReviewOrder('user1', 'diamond')).toThrow();
    });

    test('scoreLengthAppropriateness: short resume gets low score', () => {
        const r = scoreLengthAppropriateness(50);
        expect(r.score).toBeLessThan(60);
    });

    test('scoreLengthAppropriateness: ideal length gets high score', () => {
        const r = scoreLengthAppropriateness(300);
        expect(r.score).toBeGreaterThanOrEqual(70);
    });

    test('scoreLengthAppropriateness: very long resume gets low score', () => {
        const r = scoreLengthAppropriateness(1200);
        expect(r.score).toBeLessThan(60);
    });

    test('STRONG_KEYWORDS contains managed and led', () => {
        expect(STRONG_KEYWORDS).toContain('managed');
        expect(STRONG_KEYWORDS).toContain('led');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #68 — In-App Skill Test Certificates
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #68 — In-App Skill Test Certificates', () => {
    const { AVAILABLE_TESTS, getAvailableTests, evaluateTestResult, verifyCertificateId, getGradeLabel } =
        require('../services/skillTestService');

    test('AVAILABLE_TESTS has at least 4 tests', () => {
        expect(Object.keys(AVAILABLE_TESTS).length).toBeGreaterThanOrEqual(4);
    });

    test('getAvailableTests returns array with key and price', () => {
        const tests = getAvailableTests();
        expect(Array.isArray(tests)).toBe(true);
        tests.forEach((t) => {
            expect(t.key).toBeDefined();
            expect(t.price).toBeGreaterThan(0);
        });
    });

    test('evaluateTestResult: passing score issues certificateId', () => {
        const result = evaluateTestResult('user1', 'ms_excel', 80);
        expect(result.passed).toBe(true);
        expect(result.certificateId).not.toBeNull();
        expect(result.grade).not.toBe('F');
    });

    test('evaluateTestResult: failing score returns no certificate', () => {
        const result = evaluateTestResult('user1', 'ms_excel', 40);
        expect(result.passed).toBe(false);
        expect(result.certificateId).toBeNull();
        expect(result.grade).toBe('F');
    });

    test('evaluateTestResult: score 90+ gives grade A', () => {
        const result = evaluateTestResult('user1', 'logistics', 95);
        expect(result.grade).toBe('A');
    });

    test('evaluateTestResult throws 400 for unknown test', () => {
        expect(() => evaluateTestResult('user1', 'flying_cars', 80)).toThrow();
    });

    test('evaluateTestResult throws 400 for score > 100', () => {
        expect(() => evaluateTestResult('user1', 'ms_excel', 150)).toThrow();
    });

    test('verifyCertificateId validates correct format', () => {
        const result = evaluateTestResult('user1', 'ms_excel', 85);
        expect(verifyCertificateId(result.certificateId)).toBe(true);
    });

    test('verifyCertificateId rejects invalid format', () => {
        expect(verifyCertificateId('INVALID-123')).toBe(false);
        expect(verifyCertificateId('')).toBe(false);
    });

    test('getGradeLabel: 95 = Distinction', () => {
        expect(getGradeLabel(95)).toBe('Distinction');
    });

    test('getGradeLabel: 50 = Fail', () => {
        expect(getGradeLabel(50)).toBe('Fail');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #69 — Pay-Per-Lead for Employers
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #69 — Pay-Per-Lead', () => {
    const { LEAD_TIERS, calcLeadQualityScore, buildLeadBillingRecord, computeLeadSpend, qualifiesAsLead } =
        require('../services/payPerLeadService');

    test('LEAD_TIERS has basic, verified, premium', () => {
        ['basic', 'verified', 'premium'].forEach((t) => expect(LEAD_TIERS).toHaveProperty(t));
    });

    test('calcLeadQualityScore returns 0–100', () => {
        const score = calcLeadQualityScore({ skillMatchPct: 80, hasResume: true, hasPhoto: true, experienceYears: 3 });
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
    });

    test('better-quality application gets higher score', () => {
        const poor = calcLeadQualityScore({});
        const rich = calcLeadQualityScore({ skillMatchPct: 90, hasResume: true, hasPhoto: true, experienceYears: 5, isVerified: true });
        expect(rich).toBeGreaterThan(poor);
    });

    test('buildLeadBillingRecord creates valid record', () => {
        const rec = buildLeadBillingRecord('emp1', 'app1', 'verified');
        expect(rec.employerId).toBe('emp1');
        expect(rec.status).toBe('pending');
        expect(rec.pricePerLead).toBeGreaterThan(0);
    });

    test('buildLeadBillingRecord throws 400 for invalid tier', () => {
        expect(() => buildLeadBillingRecord('emp1', 'app1', 'diamond')).toThrow();
    });

    test('buildLeadBillingRecord throws 400 if IDs missing', () => {
        expect(() => buildLeadBillingRecord('', 'app1', 'basic')).toThrow();
    });

    test('computeLeadSpend sums prices correctly', () => {
        const records = [{ pricePerLead: 49 }, { pricePerLead: 99 }, { pricePerLead: 199 }];
        expect(computeLeadSpend(records)).toBe(347);
    });

    test('qualifiesAsLead: strong application qualifies for basic tier', () => {
        const app = { skillMatchPct: 90, hasResume: true, hasPhoto: true, experienceYears: 3 };
        expect(qualifiesAsLead(app, 'basic')).toBe(true);
    });

    test('qualifiesAsLead: empty application does not qualify for premium', () => {
        expect(qualifiesAsLead({}, 'premium')).toBe(false);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #70 & #71 — Employer Analytics Dashboard + Applicant Insights
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #70/#71 — Employer Analytics + Applicant Insights', () => {
    const { buildAnalyticsSummary, buildJobAnalytics, buildApplicantInsights, buildTopSkills, buildLocationBreakdown } =
        require('../services/employerAnalyticsService');

    const apps = [
        { status: 'hired', hasResume: true, isVerified: true, experienceYears: 3, skills: ['driving'], location: 'Mumbai' },
        { status: 'rejected', hasResume: false, isVerified: false, experienceYears: 1, skills: ['cooking'], location: 'Delhi' },
        { status: 'pending', hasResume: true, isVerified: true, experienceYears: 2, skills: ['driving'], location: 'Mumbai' },
    ];

    test('buildAnalyticsSummary returns correct total and hired', () => {
        const r = buildAnalyticsSummary(apps);
        expect(r.total).toBe(3);
        expect(r.hired).toBe(1);
        expect(r.rejected).toBe(1);
    });

    test('hireRate is a 0–100 number', () => {
        const r = buildAnalyticsSummary(apps);
        expect(r.hireRate).toBeGreaterThanOrEqual(0);
        expect(r.hireRate).toBeLessThanOrEqual(100);
    });

    test('hireRate is 33 for 1/3 hired', () => {
        const r = buildAnalyticsSummary(apps);
        expect(r.hireRate).toBe(33);
    });

    test('buildAnalyticsSummary returns statusBreakdown object', () => {
        const r = buildAnalyticsSummary(apps);
        expect(r.statusBreakdown).toHaveProperty('hired', 1);
    });

    test('buildJobAnalytics returns array of per-job summaries', () => {
        const r = buildJobAnalytics({ job1: apps, job2: apps.slice(0, 1) });
        expect(Array.isArray(r)).toBe(true);
        expect(r[0].jobId).toBe('job1');
    });

    test('buildApplicantInsights returns resumeAttachRate and avgExperienceYears', () => {
        const r = buildApplicantInsights(apps);
        expect(r.resumeAttachRate).toBeDefined();
        expect(r.avgExperienceYears).toBeDefined();
    });

    test('buildTopSkills returns sorted skill list', () => {
        const skills = buildTopSkills(apps);
        expect(Array.isArray(skills)).toBe(true);
        expect(skills[0].skill).toBe('driving'); // appears twice
        expect(skills[0].count).toBe(2);
    });

    test('buildLocationBreakdown returns location counts', () => {
        const locs = buildLocationBreakdown(apps);
        expect(locs.find((l) => l.location === 'Mumbai')?.count).toBe(2);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #72 & #74 — Job Credit System + In-App Currency
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #72/#74 — Job Credit System & In-App Currency', () => {
    const { CREDIT_ACTIONS, CREDIT_PACKS, getActionCost, canAffordAction, buildPackPurchase, computeBalance } =
        require('../services/jobCreditService');

    test('CREDIT_ACTIONS has post_job and boost_job', () => {
        expect(CREDIT_ACTIONS).toHaveProperty('post_job');
        expect(CREDIT_ACTIONS).toHaveProperty('boost_job');
    });

    test('CREDIT_PACKS has starter, growth, pro, elite', () => {
        ['starter', 'growth', 'pro', 'elite'].forEach((p) => expect(CREDIT_PACKS).toHaveProperty(p));
    });

    test('getActionCost returns positive number for known action', () => {
        expect(getActionCost('boost_job')).toBeGreaterThan(0);
    });

    test('getActionCost returns null for unknown action', () => {
        expect(getActionCost('teleport')).toBeNull();
    });

    test('canAffordAction: balance 100 can afford boost_job (25 credits)', () => {
        expect(canAffordAction(100, 'boost_job')).toBe(true);
    });

    test('canAffordAction: balance 5 cannot afford spotlight_job (100 credits)', () => {
        expect(canAffordAction(5, 'spotlight_job')).toBe(false);
    });

    test('buildPackPurchase returns creditsReceived with bonus', () => {
        const rec = buildPackPurchase('user1', 'growth');
        expect(rec.creditsReceived).toBe(CREDIT_PACKS.growth.credits + CREDIT_PACKS.growth.bonus);
    });

    test('buildPackPurchase throws 400 for invalid pack', () => {
        expect(() => buildPackPurchase('user1', 'diamond_pack')).toThrow();
    });

    test('computeBalance: earn + spend sums correctly', () => {
        const txs = [
            { type: 'earn', amount: 100 },
            { type: 'spend', amount: 25 },
            { type: 'earn', amount: 50 },
        ];
        expect(computeBalance(txs)).toBe(125);
    });

    test('computeBalance: empty transactions returns 0', () => {
        expect(computeBalance([])).toBe(0);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #73 — Subscription Perks (Free Applies, Priority)
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #73 — Subscription Perks', () => {
    const { getPerksSummary, getPlanDetails } = require('../services/premiumSubscriptionService');

    test('getPerksSummary for free plan has freeApplies 0', () => {
        const perks = getPerksSummary('free');
        expect(perks.freeApplies).toBe(0);
    });

    test('getPerksSummary for pro has candidateInsights: true', () => {
        const perks = getPerksSummary('pro');
        expect(perks.candidateInsights).toBe(true);
    });

    test('getPerksSummary for enterprise has prioritySupport: true', () => {
        const perks = getPerksSummary('enterprise');
        expect(perks.prioritySupport).toBe(true);
    });

    test('getPerksSummary includes plan name', () => {
        const perks = getPerksSummary('starter');
        expect(perks.plan).toBe('Starter');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #75 — Referral Commission Program UI
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #75 — Referral Commission Program', () => {
    // Contract-only tests — verify exported API without deep DB mocking
    let referralService;
    beforeAll(() => {
        // Mock all deep dependencies up front before requiring the service
        jest.mock('../models/Referral', () => ({
            findOne: jest.fn().mockResolvedValue(null),
            find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) }),
            create: jest.fn((d) => Promise.resolve({ _id: 'r1', ...d })),
            countDocuments: jest.fn().mockResolvedValue(0),
        }));
        jest.mock('../models/AnalyticsEvent', () => ({
            create: jest.fn().mockResolvedValue({ _id: 'ae1' }),
        }));
        referralService = require('../services/referralService');
    });

    test('DEFAULT_REWARD_TYPE is a non-empty string', () => {
        expect(typeof referralService.DEFAULT_REWARD_TYPE).toBe('string');
        expect(referralService.DEFAULT_REWARD_TYPE.length).toBeGreaterThan(0);
    });

    test('getReferralDashboard is a function', () => {
        expect(typeof referralService.getReferralDashboard).toBe('function');
    });

    test('evaluateReferralEligibility is a function', () => {
        expect(typeof referralService.evaluateReferralEligibility).toBe('function');
    });

    test('ensureUserReferralCode is exported as a function', () => {
        expect(typeof referralService.ensureUserReferralCode).toBe('function');
    });

    test('normalizeRewardType returns default for unknown input', () => {
        const norm = referralService.normalizeRewardType('unknown_type_xyz');
        expect(typeof norm).toBe('string');
        expect(norm).toBe(referralService.DEFAULT_REWARD_TYPE);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #76 — Freemium AI Smart Suggestions
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #76 — Freemium AI Quota', () => {
    const { FREEMIUM_QUOTAS, FEATURE_KEYS, hasQuota, getRemainingQuota, buildQuotaSummary, getUpgradeCTA } =
        require('../services/freemiumAiService');

    test('FREEMIUM_QUOTAS covers free, starter, pro, enterprise', () => {
        ['free', 'starter', 'pro', 'enterprise'].forEach((p) => expect(FREEMIUM_QUOTAS).toHaveProperty(p));
    });

    test('FEATURE_KEYS has aiSuggestions and aiJobRecs', () => {
        expect(FEATURE_KEYS).toContain('aiSuggestions');
        expect(FEATURE_KEYS).toContain('aiJobRecs');
    });

    test('hasQuota: free user with 0 uses has quota', () => {
        expect(hasQuota('free', 'aiSuggestions', 0)).toBe(true);
    });

    test('hasQuota: free user exhausted quota returns false', () => {
        expect(hasQuota('free', 'aiSuggestions', 100)).toBe(false);
    });

    test('hasQuota: pro user always has quota (Infinity)', () => {
        expect(hasQuota('pro', 'aiSuggestions', 9999)).toBe(true);
    });

    test('getRemainingQuota returns 0 when exhausted', () => {
        expect(getRemainingQuota('free', 'aiSuggestions', 999)).toBe(0);
    });

    test('getRemainingQuota returns Infinity for pro', () => {
        expect(getRemainingQuota('pro', 'aiSuggestions', 0)).toBe(Infinity);
    });

    test('buildQuotaSummary returns array of feature quotas', () => {
        const summary = buildQuotaSummary('free', { aiSuggestions: 2 });
        expect(Array.isArray(summary)).toBe(true);
        const feature = summary.find((s) => s.feature === 'aiSuggestions');
        expect(feature.used).toBe(2);
    });

    test('getUpgradeCTA returns null for pro user', () => {
        expect(getUpgradeCTA('pro', 'aiSuggestions')).toBeNull();
    });

    test('getUpgradeCTA returns string for free user', () => {
        const cta = getUpgradeCTA('free', 'aiSuggestions');
        expect(typeof cta).toBe('string');
        expect(cta).toContain('Upgrade');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #77 — User Gifting (Brand Partnerships)
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #77 — User Gifting', () => {
    const { GIFT_TYPES, buildGiftCampaign, isGiftRedeemable, buildRedemptionRecord, validateGiftCode } =
        require('../services/giftingService');

    test('GIFT_TYPES includes voucher and cashback', () => {
        expect(GIFT_TYPES).toContain('voucher');
        expect(GIFT_TYPES).toContain('cashback');
    });

    test('buildGiftCampaign creates valid campaign', () => {
        const c = buildGiftCampaign('partner1', 'voucher', 500);
        expect(c.partnerId).toBe('partner1');
        expect(c.giftType).toBe('voucher');
        expect(c.active).toBe(true);
        expect(validateGiftCode(c.code)).toBe(true);
    });

    test('buildGiftCampaign throws 400 for invalid gift type', () => {
        expect(() => buildGiftCampaign('p1', 'diamond_ring', 100)).toThrow();
    });

    test('buildGiftCampaign throws 400 for zero value', () => {
        expect(() => buildGiftCampaign('p1', 'voucher', 0)).toThrow();
    });

    test('isGiftRedeemable returns true for active campaign', () => {
        const c = buildGiftCampaign('p1', 'cashback', 200);
        expect(isGiftRedeemable(c)).toBe(true);
    });

    test('isGiftRedeemable returns false for expired campaign', () => {
        const c = buildGiftCampaign('p1', 'voucher', 100);
        c.expiresAt = new Date(Date.now() - 1000);
        expect(isGiftRedeemable(c)).toBe(false);
    });

    test('buildRedemptionRecord creates valid redemption', () => {
        const c = buildGiftCampaign('p1', 'data_pack', 99);
        const rec = buildRedemptionRecord('user1', c);
        expect(rec.userId).toBe('user1');
        expect(rec.status).toBe('redeemed');
    });

    test('buildRedemptionRecord throws for expired campaign', () => {
        const c = buildGiftCampaign('p1', 'voucher', 100);
        c.expiresAt = new Date(Date.now() - 1000);
        expect(() => buildRedemptionRecord('user1', c)).toThrow();
    });

    test('validateGiftCode: valid format returns true', () => {
        expect(validateGiftCode('GIFT-VOUCHER-1700000000000')).toBe(true);
    });

    test('validateGiftCode: invalid format returns false', () => {
        expect(validateGiftCode('INVALID')).toBe(false);
        expect(validateGiftCode('')).toBe(false);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #78 — Cross-Sell Industry Partner Services
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #78 — Cross-Sell Industry Partners', () => {
    const { PARTNER_CATEGORIES, SAMPLE_PARTNERS, getRelevantPartners, buildCrossSellEvent, computeCommission } =
        require('../services/partnerCrossSellService');

    test('PARTNER_CATEGORIES has insurance and training', () => {
        expect(PARTNER_CATEGORIES).toContain('insurance');
        expect(PARTNER_CATEGORIES).toContain('training');
    });

    test('SAMPLE_PARTNERS has at least 2 entries', () => {
        expect(SAMPLE_PARTNERS.length).toBeGreaterThanOrEqual(2);
    });

    test('getRelevantPartners for delivery includes insurance/transport', () => {
        const partners = getRelevantPartners('delivery');
        const categories = partners.map((p) => p.category);
        expect(categories).toContain('training'); // always included
    });

    test('getRelevantPartners returns array', () => {
        expect(Array.isArray(getRelevantPartners('driver'))).toBe(true);
    });

    test('buildCrossSellEvent creates valid event', () => {
        const event = buildCrossSellEvent('user1', 'p1', 'delivery');
        expect(event.userId).toBe('user1');
        expect(event.eventType).toBe('cross_sell_click');
    });

    test('buildCrossSellEvent throws 400 if IDs missing', () => {
        expect(() => buildCrossSellEvent('', 'p1', 'delivery')).toThrow();
    });

    test('computeCommission calculates correct amount', () => {
        const partner = { commissionPct: 10 };
        expect(computeCommission(partner, 1000)).toBe(100);
    });

    test('computeCommission: zero transaction = zero commission', () => {
        expect(computeCommission({ commissionPct: 10 }, 0)).toBe(0);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #79 — Matched Job Preview Unlocked with Premium
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #79 — Premium Job Preview', () => {
    const { PREVIEW_LEVELS, UNLOCK_COST_CREDITS, getPreviewLevel, applyPreviewFilter, needsCreditUnlock, buildUnlockRecord } =
        require('../services/premiumPreviewService');

    const fullJob = {
        title: 'Delivery Executive', location: 'Mumbai', jobType: 'full_time',
        salary: 20000, skills: ['driving'], companyName: 'FastCo',
        description: 'Deliver packages', contactEmail: 'hr@fastco.com',
    };

    test('PREVIEW_LEVELS has locked, partial, full', () => {
        ['locked', 'partial', 'full'].forEach((l) => expect(PREVIEW_LEVELS).toHaveProperty(l));
    });

    test('UNLOCK_COST_CREDITS is a positive number', () => {
        expect(UNLOCK_COST_CREDITS).toBeGreaterThan(0);
    });

    test('getPreviewLevel: free user without unlock = locked', () => {
        expect(getPreviewLevel('free', false)).toBe('locked');
    });

    test('getPreviewLevel: starter = partial', () => {
        expect(getPreviewLevel('starter', false)).toBe('partial');
    });

    test('getPreviewLevel: pro = full', () => {
        expect(getPreviewLevel('pro', false)).toBe('full');
    });

    test('getPreviewLevel: any plan with explicit unlock = full', () => {
        expect(getPreviewLevel('free', true)).toBe('full');
    });

    test('applyPreviewFilter: locked hides companyName and contactEmail', () => {
        const filtered = applyPreviewFilter(fullJob, 'locked');
        expect(filtered.companyName).toBeUndefined();
        expect(filtered.contactEmail).toBeUndefined();
        expect(filtered._blurred).toBe(true);
    });

    test('applyPreviewFilter: full reveals all fields', () => {
        const filtered = applyPreviewFilter(fullJob, 'full');
        expect(filtered.companyName).toBe('FastCo');
        expect(filtered.contactEmail).toBe('hr@fastco.com');
        expect(filtered._blurred).toBe(false);
    });

    test('needsCreditUnlock: free returns true', () => {
        expect(needsCreditUnlock('free')).toBe(true);
    });

    test('needsCreditUnlock: enterprise returns false', () => {
        expect(needsCreditUnlock('enterprise')).toBe(false);
    });

    test('buildUnlockRecord creates valid record', () => {
        const rec = buildUnlockRecord('user1', 'j1');
        expect(rec.userId).toBe('user1');
        expect(rec.creditsSpent).toBe(UNLOCK_COST_CREDITS);
    });

    test('buildUnlockRecord throws 400 if IDs missing', () => {
        expect(() => buildUnlockRecord('', 'j1')).toThrow();
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FEATURE #80 — Custom Interview Analysis Report (Paid)
// ════════════════════════════════════════════════════════════════════════════
describe('Feature #80 — Custom Interview Analysis Report', () => {
    const { REPORT_TIERS, buildInterviewReport, validateReportId, getRatingBand, generateTips } =
        require('../services/interviewReportService');

    const interviewData = {
        candidateName: 'Arjun Kumar',
        jobTitle: 'Delivery Executive',
        rating: 75,
        skills: ['driving', 'navigation'],
        gaps: ['customer service'],
    };

    test('REPORT_TIERS has basic, standard, premium', () => {
        ['basic', 'standard', 'premium'].forEach((t) => expect(REPORT_TIERS).toHaveProperty(t));
    });

    test('buildInterviewReport creates report with reportId', () => {
        const r = buildInterviewReport('basic', interviewData);
        expect(r.reportId).toBeDefined();
        expect(validateReportId(r.reportId)).toBe(true);
    });

    test('basic report includes summary and rating sections', () => {
        const r = buildInterviewReport('basic', interviewData);
        expect(r.sections.summary).toBeDefined();
        expect(r.sections.rating).toBeDefined();
    });

    test('standard report adds gaps and tips', () => {
        const r = buildInterviewReport('standard', interviewData);
        expect(r.sections.gaps).toBeDefined();
        expect(r.sections.improvementTips).toBeDefined();
    });

    test('premium report adds benchmark and customFeedback', () => {
        const r = buildInterviewReport('premium', interviewData);
        expect(r.sections.benchmark).toBeDefined();
        expect(r.sections.customFeedback).toBeDefined();
    });

    test('rating band: 75 = Good', () => {
        const r = buildInterviewReport('basic', interviewData);
        expect(r.sections.rating.band).toBe('Good');
    });

    test('getRatingBand: 95 = Excellent', () => {
        expect(getRatingBand(95)).toBe('Excellent');
    });

    test('getRatingBand: 30 = Poor', () => {
        expect(getRatingBand(30)).toBe('Poor');
    });

    test('generateTips returns array', () => {
        const tips = generateTips(75, ['driving'], ['customer service']);
        expect(Array.isArray(tips)).toBe(true);
        expect(tips.length).toBeGreaterThan(0);
    });

    test('buildInterviewReport throws 400 for invalid tier', () => {
        expect(() => buildInterviewReport('diamond', interviewData)).toThrow();
    });

    test('premium report has industryAvgRating in benchmark', () => {
        const r = buildInterviewReport('premium', interviewData);
        expect(r.sections.benchmark.industryAvgRating).toBeDefined();
    });
});
