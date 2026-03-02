'use strict';
/**
 * blockEFeatures.test.js
 * BLOCK E Feature Add-on Tests (Features #7, #17, #37, #48, #95, #97, #100)
 */

// ── Model mocks ──────────────────────────────────────────────────────────────
jest.mock('../models/SavedJobCollection', () => {
    const docs = [];
    return {
        find: jest.fn(() => ({ sort: jest.fn(() => ({ select: jest.fn(() => ({ lean: jest.fn(async () => docs) })) })) })),
        findOne: jest.fn(async (q) => docs.find((d) => String(d._id) === String(q._id || ''))),
        countDocuments: jest.fn(async () => docs.length),
        create: jest.fn(async (data) => {
            const doc = { _id: 'col1', ...data, jobs: [], toObject() { return this; } };
            docs.push(doc);
            return doc;
        }),
    };
});

jest.mock('../models/CompanyFollow', () => {
    const follows = [];
    return {
        find: jest.fn(() => ({ sort: jest.fn(() => ({ select: jest.fn(() => ({ lean: jest.fn(async () => follows) })) })) })),
        create: jest.fn(async (data) => {
            const existing = follows.find((f) => String(f.followerId) === String(data.followerId) && String(f.employerUserId) === String(data.employerUserId));
            if (existing) { const err = new Error('dup'); err.code = 11000; throw err; }
            const doc = { _id: 'fol1', ...data };
            follows.push(doc);
            return doc;
        }),
        exists: jest.fn(async (q) => follows.some((f) => String(f.followerId) === String(q.followerId) && String(f.employerUserId) === String(q.employerUserId))),
        countDocuments: jest.fn(async () => follows.length),
        deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
        updateOne: jest.fn(async () => ({})),
    };
});

jest.mock('../models/SavedSearch', () => {
    const searches = [];
    return {
        find: jest.fn(() => ({ sort: jest.fn(() => ({ select: jest.fn(() => ({ lean: jest.fn(async () => searches) })) })) })),
        countDocuments: jest.fn(async () => searches.length),
        create: jest.fn(async (data) => {
            const doc = { _id: 'srch1', ...data, toObject() { return this; } };
            searches.push(doc);
            return doc;
        }),
        deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
        updateOne: jest.fn(async () => ({})),
    };
});

jest.mock('../models/AbuseSignal', () => {
    const signals = [];
    return {
        create: jest.fn(async (data) => {
            const doc = { _id: 'sig1', ...data };
            signals.push(doc);
            return doc;
        }),
        countDocuments: jest.fn(async () => 0),
        exists: jest.fn(async () => false),
        deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
        find: jest.fn(() => ({ select: jest.fn(() => ({ lean: jest.fn(async () => signals) })) })),
    };
});

// ── Services under test ───────────────────────────────────────────────────────
const { listCollections, createCollection, saveJobToCollection, removeJobFromCollection, deleteCollection }
    = require('../services/savedJobsService');
const { followCompany, unfollowCompany, getFollowStatus, getFollowerCount, getFollowedCompanies }
    = require('../services/companyFollowService');
const { listSavedSearches, createSavedSearch, deleteSavedSearch }
    = require('../services/savedSearchService');
const { explainMatch }
    = require('../services/matchExplainabilityService');
const { reportAbuse, blockUser, unblockUser, isBlocked }
    = require('../services/abuseFlagService');

const USER_A = 'user_aaa';
const USER_B = 'user_bbb';

// ════════════════════════════════════════════════════════════════════════════
describe('BLOCK E — Feature Add-ons Unit Tests', () => {

    // ── #7: Saved Job Collections ──────────────────────────────────────────
    describe('#7 Saved Job Collections', () => {
        it('listCollections returns array', async () => {
            const result = await listCollections(USER_A);
            expect(Array.isArray(result)).toBe(true);
        });

        it('createCollection creates a named folder', async () => {
            const col = await createCollection(USER_A, { name: 'Dream Jobs', emoji: '⭐' });
            expect(col.name).toBe('Dream Jobs');
        });

        it('createCollection rejects empty name', async () => {
            await expect(createCollection(USER_A, { name: '' })).rejects.toMatchObject({ message: 'Collection name required' });
        });
    });

    // ── #17: Saved Searches ────────────────────────────────────────────────
    describe('#17 Saved Searches', () => {
        it('listSavedSearches returns array', async () => {
            const result = await listSavedSearches(USER_A);
            expect(Array.isArray(result)).toBe(true);
        });

        it('createSavedSearch stores filters', async () => {
            const search = await createSavedSearch(USER_A, {
                name: 'DevOps Mumbai',
                filters: { keyword: 'DevOps', location: 'Mumbai', radiusKm: 30 },
                alertEnabled: true,
                alertFrequency: 'daily',
            });
            expect(search.name).toBe('DevOps Mumbai');
            expect(search.filters.radiusKm).toBe(30);
        });

        it('createSavedSearch rejects missing name', async () => {
            await expect(createSavedSearch(USER_A, {})).rejects.toMatchObject({ message: 'Search name required' });
        });
    });

    // ── #37: Follow Company ────────────────────────────────────────────────
    describe('#37 Follow Company', () => {
        it('followCompany creates a follow record', async () => {
            const result = await followCompany(USER_A, USER_B, 'Acme Corp');
            expect(result.following).toBe(true);
        });

        it('followCompany returns alreadyFollowing on duplicate', async () => {
            const result = await followCompany(USER_A, USER_B, 'Acme Corp');
            expect(result.alreadyFollowing).toBe(true);
        });

        it('cannot follow yourself', async () => {
            await expect(followCompany(USER_A, USER_A)).rejects.toMatchObject({ message: 'Cannot follow yourself' });
        });

        it('unfollowCompany returns unfollowed', async () => {
            const result = await unfollowCompany(USER_A, USER_B);
            expect(result).toHaveProperty('unfollowed');
        });

        it('getFollowerCount returns numeric count', async () => {
            const result = await getFollowerCount(USER_B);
            expect(typeof result.followerCount).toBe('number');
        });

        it('getFollowedCompanies returns array', async () => {
            const result = await getFollowedCompanies(USER_A);
            expect(Array.isArray(result)).toBe(true);
        });
    });

    // ── #48/#100: Match Explainability ────────────────────────────────────
    describe('#48/#100 Match Explainability', () => {
        const worker = {
            skills: ['React', 'Node.js', 'MongoDB'],
            experienceYears: 3,
            location: 'mumbai',
            availability: 'full_time',
            badgeCount: 2,
        };
        const job = {
            skills: ['React', 'Node.js', 'TypeScript'],
            minExperienceYears: 2,
            maxExperienceYears: 5,
            location: 'mumbai',
            jobType: 'full_time',
        };

        it('explainMatch returns an object with overallScore', () => {
            const result = explainMatch(worker, job, 78);
            expect(result).toHaveProperty('overallScore', 78);
        });

        it('explainMatch returns dimension scores 0-100', () => {
            const result = explainMatch(worker, job, 78);
            expect(result.dimensions.skills.score).toBeGreaterThanOrEqual(0);
            expect(result.dimensions.skills.score).toBeLessThanOrEqual(100);
            expect(result.dimensions.location.score).toBe(100);
        });

        it('explainMatch populates matchedSkills correctly', () => {
            const result = explainMatch(worker, job, 78);
            expect(result.dimensions.skills.matchedSkills).toContain('react');
            expect(result.dimensions.skills.matchedSkills).toContain('node.js');
            expect(result.dimensions.skills.matchedSkills).not.toContain('typescript');
        });

        it('explainMatch gives positive and gap arrays', () => {
            const result = explainMatch(worker, job, 78);
            expect(Array.isArray(result.positives)).toBe(true);
            expect(Array.isArray(result.gaps)).toBe(true);
        });

        it('explainMatch is deterministic', () => {
            const r1 = explainMatch(worker, job, 78);
            const r2 = explainMatch(worker, job, 78);
            expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
        });

        it('explainMatch handles missing worker data gracefully', () => {
            const result = explainMatch({}, job, 0);
            expect(result).toHaveProperty('overallScore', 0);
            expect(result.dimensions.skills.matchedSkills).toEqual([]);
        });
    });

    // ── #95: Abuse Report / Block ─────────────────────────────────────────
    describe('#95 Report Abuse / Block User', () => {
        it('reportAbuse creates a signal for valid type', async () => {
            const result = await reportAbuse({
                reporterId: USER_A,
                targetType: 'user',
                targetId: USER_B,
                abuseType: 'harassment',
                description: 'Inappropriate messages',
            });
            expect(result).toHaveProperty('reported', true);
            expect(result).toHaveProperty('signalId');
        });

        it('reportAbuse rejects invalid abuseType', async () => {
            await expect(reportAbuse({
                reporterId: USER_A,
                targetType: 'user',
                targetId: USER_B,
                abuseType: 'invalid_type',
            })).rejects.toMatchObject({ message: expect.stringContaining('Invalid abuse type') });
        });

        it('reportAbuse rejects missing targetId', async () => {
            await expect(reportAbuse({
                reporterId: USER_A,
                targetType: 'user',
                abuseType: 'spam',
            })).rejects.toMatchObject({ message: 'targetType and targetId required' });
        });

        it('blockUser creates a block signal', async () => {
            const result = await blockUser(USER_A, USER_B);
            expect(result).toHaveProperty('blocked', true);
        });

        it('blockUser cannot block self', async () => {
            await expect(blockUser(USER_A, USER_A)).rejects.toMatchObject({ message: 'Cannot block yourself' });
        });

        it('unblockUser returns unblocked flag', async () => {
            const result = await unblockUser(USER_A, USER_B);
            expect(result).toHaveProperty('unblocked');
        });
    });
});
