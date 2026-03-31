const DailyJobMetrics = require('../models/DailyJobMetrics');
const DailyFinancialMetrics = require('../models/DailyFinancialMetrics');
const DailyTrustMetrics = require('../models/DailyTrustMetrics');
const DailyRegionMetrics = require('../models/DailyRegionMetrics');
const SkillTrendWeekly = require('../models/SkillTrendWeekly');
const StrategicInsight = require('../models/StrategicInsight');

const round = (value, digits = 2) => {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return 0;
    const factor = 10 ** digits;
    return Math.round(num * factor) / factor;
};

const findPreviousDayMetrics = async (Model, dateKey) => Model.findOne({ dateKey: { $lt: dateKey } })
    .sort({ dateKey: -1 })
    .lean();

const safeCreateInsight = async (payload) => {
    try {
        return await StrategicInsight.create(payload);
    } catch (error) {
        if (error?.code === 11000) return null;
        throw error;
    }
};

const getWeekKeyFromDateKey = (dateKey) => {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

const getLatestInsights = async ({ limit = 20 } = {}) => StrategicInsight.find({})
    .sort({ generatedAt: -1 })
    .limit(Math.max(1, Math.min(200, Number(limit) || 20)))
    .lean();

const generateDeterministicInsights = async ({ dateKey }) => {
    const createdInsights = [];

    const [todayJob, prevJob, todayFinancial, todayTrust, prevTrust] = await Promise.all([
        DailyJobMetrics.findOne({ dateKey }).lean(),
        findPreviousDayMetrics(DailyJobMetrics, dateKey),
        DailyFinancialMetrics.findOne({ dateKey }).lean(),
        DailyTrustMetrics.findOne({ dateKey }).lean(),
        findPreviousDayMetrics(DailyTrustMetrics, dateKey),
    ]);

    if (todayJob && prevJob && Number(prevJob.interviewCompletionRate || 0) > 0) {
        const delta = Number(todayJob.interviewCompletionRate || 0) - Number(prevJob.interviewCompletionRate || 0);
        if (delta <= -0.05) {
            const deltaPct = round(Math.abs(delta) * 100, 2);
            const row = await safeCreateInsight({
                dateKey,
                insightType: 'INTERVIEW_COMPLETION_DROP',
                severity: delta <= -0.1 ? 'critical' : 'warning',
                title: 'Interview Completion Decline',
                message: `Interview completion dropped ${deltaPct}% versus the prior day.`,
                deterministicRule: 'if interview_completion_delta <= -0.05',
                evidence: {
                    currentRate: todayJob.interviewCompletionRate,
                    previousRate: prevJob.interviewCompletionRate,
                    delta,
                },
            });
            if (row) createdInsights.push(row);
        }
    }

    if (todayTrust && Number(todayTrust.highTrustCloseSpeedMultiplier || 0) >= 1.8) {
        const ratio = round(todayTrust.highTrustCloseSpeedMultiplier, 2);
        const row = await safeCreateInsight({
            dateKey,
            insightType: 'HIGH_TRUST_FASTER_HIRING',
            severity: ratio >= 2 ? 'info' : 'warning',
            title: 'High-Trust Employers Close Faster',
            message: `High-trust employers are closing hires ${ratio}x faster than lower-trust employers.`,
            deterministicRule: 'if high_trust_close_speed_multiplier >= 1.8',
            evidence: {
                multiplier: todayTrust.highTrustCloseSpeedMultiplier,
                highTrustHireSpeedHours: todayTrust.highTrustHireSpeedHours,
                lowTrustHireSpeedHours: todayTrust.lowTrustHireSpeedHours,
            },
        });
        if (row) createdInsights.push(row);
    } else if (todayTrust && prevTrust && Number(prevTrust.highTrustCloseSpeedMultiplier || 0) > 0) {
        const delta = Number(todayTrust.highTrustCloseSpeedMultiplier || 0) - Number(prevTrust.highTrustCloseSpeedMultiplier || 0);
        if (delta >= 0.4) {
            const row = await safeCreateInsight({
                dateKey,
                insightType: 'TRUST_VELOCITY_IMPROVING',
                severity: 'info',
                title: 'Trust Velocity Improving',
                message: `High-trust hire velocity improved by ${round(delta, 2)}x versus the prior day.`,
                deterministicRule: 'if trust_multiplier_delta >= 0.4',
                evidence: {
                    current: todayTrust.highTrustCloseSpeedMultiplier,
                    previous: prevTrust.highTrustCloseSpeedMultiplier,
                    delta,
                },
            });
            if (row) createdInsights.push(row);
        }
    }

    if (todayFinancial && todayJob) {
        const escrowRate = Number(todayFinancial.escrowReleaseRate || 0);
        const hireRate = Number(todayJob.hireSuccessRate || 0);
        if (escrowRate >= 0.35 && hireRate >= 0.12) {
            const row = await safeCreateInsight({
                dateKey,
                insightType: 'ESCROW_CORRELATION',
                severity: 'info',
                title: 'Escrow Adoption Correlates With Hire Completion',
                message: 'Higher escrow release adoption is aligned with stronger hire completion outcomes.',
                deterministicRule: 'if escrow_release_rate >= 0.35 and hire_success_rate >= 0.12',
                evidence: {
                    escrowReleaseRate: escrowRate,
                    hireSuccessRate: hireRate,
                },
            });
            if (row) createdInsights.push(row);
        }
    }

    const weekKey = getWeekKeyFromDateKey(dateKey);
    if (weekKey) {
        const topSkill = await SkillTrendWeekly.findOne({ weekKey })
            .sort({ growthRateWoW: -1, hiredCount: -1, searchedCount: -1 })
            .lean();
        if (topSkill && Number(topSkill.growthRateWoW || 0) >= 0.15) {
            const growthPct = round(Number(topSkill.growthRateWoW || 0) * 100, 2);
            const row = await safeCreateInsight({
                dateKey,
                insightType: 'SKILL_GROWTH_SPIKE',
                severity: growthPct >= 30 ? 'warning' : 'info',
                title: 'Skill Demand Shift',
                message: `${topSkill.skill} demand increased ${growthPct}% week-over-week.`,
                deterministicRule: 'if top_skill_growth_rate_wow >= 0.15',
                evidence: {
                    weekKey,
                    skill: topSkill.skill,
                    growthRateWoW: topSkill.growthRateWoW,
                    searchedCount: topSkill.searchedCount,
                    hiredCount: topSkill.hiredCount,
                },
            });
            if (row) createdInsights.push(row);
        }
    }

    const topRegion = await DailyRegionMetrics.findOne({ dateKey })
        .sort({ revenuePerActiveUser: -1, revenue: -1 })
        .lean();
    if (topRegion && Number(topRegion.revenue || 0) > 0) {
        const row = await safeCreateInsight({
            dateKey,
            insightType: 'TOP_REVENUE_REGION',
            severity: 'info',
            title: 'Top Performing Region',
            message: `${topRegion.region} is the highest revenue-per-active-user region for the day.`,
            deterministicRule: 'top region by revenue_per_active_user',
            evidence: {
                region: topRegion.region,
                revenue: topRegion.revenue,
                revenuePerActiveUser: topRegion.revenuePerActiveUser,
                conversionRate: topRegion.conversionRate,
            },
        });
        if (row) createdInsights.push(row);
    }

    return {
        dateKey,
        createdCount: createdInsights.length,
        insights: createdInsights,
    };
};

module.exports = {
    generateDeterministicInsights,
    getLatestInsights,
};
