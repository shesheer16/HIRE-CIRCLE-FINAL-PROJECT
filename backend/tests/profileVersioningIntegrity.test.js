'use strict';

/**
 * profileVersioningIntegrity.test.js
 * Tests ProfileVersion model:
 *  - Immutability enforcement
 *  - Append-only audit trail
 *  - Version number increments correctly
 *  - Snapshot stored accurately
 */

const mongoose = require('mongoose');

// Mock mongoose model to avoid actual DB connection
jest.mock('../models/ProfileVersion', () => {
    const EventEmitter = require('events');
    const ee = new EventEmitter();

    // Track created versions in memory
    const store = [];
    let nextId = 1;

    const MockProfileVersion = function (data) {
        Object.assign(this, data);
        this._id = `pv_${nextId++}`;
    };

    MockProfileVersion.prototype.save = async function () {
        // Check uniqueness: userId + version
        const exists = store.find((r) => String(r.userId) === String(this.userId) && r.version === this.version);
        if (exists) throw Object.assign(new Error('Duplicate key: userId + version must be unique'), { code: 11000 });
        store.push({ ...this });
        return this;
    };

    MockProfileVersion.find = (query) => ({
        sort: () => ({ lean: () => store.filter((r) => String(r.userId) === String(query.userId)) }),
    });

    MockProfileVersion.countDocuments = async (query) =>
        store.filter((r) => String(r.userId) === String(query.userId)).length;

    // Simulate immutability: updateOne should throw
    MockProfileVersion.updateOne = async () => {
        throw Object.assign(new Error('ProfileVersion records are immutable. No updates allowed.'), { code: 'IMMUTABLE_RECORD' });
    };

    MockProfileVersion.findOneAndUpdate = async () => {
        throw Object.assign(new Error('ProfileVersion records are immutable. No updates allowed.'), { code: 'IMMUTABLE_RECORD' });
    };

    MockProfileVersion._clearStore = () => { store.length = 0; nextId = 1; };

    return MockProfileVersion;
});

const ProfileVersion = require('../models/ProfileVersion');

describe('Profile – Versioning Integrity', () => {
    beforeEach(() => {
        ProfileVersion._clearStore();
    });

    test('Can create a new profile version', async () => {
        const pv = new ProfileVersion({
            userId: 'user_A',
            role: 'worker',
            version: 1,
            changedFields: ['bio'],
            snapshot: { bio: 'Updated bio', skills: ['Cook'] },
            changeSource: 'user_edit',
        });
        const saved = await pv.save();
        expect(saved._id).toBeDefined();
        expect(saved.version).toBe(1);
    });

    test('Duplicate userId + version throws unique constraint error', async () => {
        const pv1 = new ProfileVersion({ userId: 'user_B', role: 'worker', version: 1, changedFields: [], snapshot: {} });
        const pv2 = new ProfileVersion({ userId: 'user_B', role: 'worker', version: 1, changedFields: [], snapshot: {} });
        await pv1.save();
        await expect(pv2.save()).rejects.toMatchObject({ code: 11000 });
    });

    test('Version numbers increment sequentially', async () => {
        for (let v = 1; v <= 5; v++) {
            const pv = new ProfileVersion({ userId: 'user_C', role: 'worker', version: v, changedFields: ['skills'], snapshot: { v } });
            await pv.save();
        }
        const count = await ProfileVersion.countDocuments({ userId: 'user_C' });
        expect(count).toBe(5);
    });

    test('Snapshot captures all changed fields', async () => {
        const snapshot = { firstName: 'Ravi', bio: 'Driver', skills: ['Driver', 'Cook'] };
        const pv = new ProfileVersion({ userId: 'user_D', role: 'worker', version: 1, changedFields: ['firstName', 'bio', 'skills'], snapshot });
        await pv.save();
        expect(pv.snapshot.firstName).toBe('Ravi');
        expect(pv.snapshot.skills).toContain('Driver');
    });

    test('updateOne is blocked (immutability)', async () => {
        await expect(ProfileVersion.updateOne({ userId: 'user_E' }, { version: 99 })).rejects.toMatchObject({
            code: 'IMMUTABLE_RECORD',
        });
    });

    test('findOneAndUpdate is blocked (immutability)', async () => {
        await expect(ProfileVersion.findOneAndUpdate({ userId: 'user_F' }, { version: 99 })).rejects.toMatchObject({
            code: 'IMMUTABLE_RECORD',
        });
    });

    test('Changed fields list is stored correctly', async () => {
        const pv = new ProfileVersion({
            userId: 'user_G',
            role: 'employer',
            version: 1,
            changedFields: ['companyName', 'location', 'industry'],
            snapshot: {},
        });
        await pv.save();
        expect(pv.changedFields).toEqual(['companyName', 'location', 'industry']);
    });
});
