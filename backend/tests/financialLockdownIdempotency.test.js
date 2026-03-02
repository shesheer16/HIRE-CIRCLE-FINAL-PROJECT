jest.mock('../models/IdempotencyKey', () => {
    const store = new Map();

    const cloneRecord = (record) => {
        if (!record) return null;
        return {
            ...record,
            async save() {
                const updated = {
                    ...record,
                    ...this,
                    updatedAt: new Date(),
                };
                store.set(String(updated.compositeKey), updated);
                return cloneRecord(updated);
            },
        };
    };

    return {
        __reset: () => store.clear(),
        async findOne(query = {}) {
            const key = String(query.compositeKey || '');
            return cloneRecord(store.get(key) || null);
        },
        async create(payload = {}) {
            const key = String(payload.compositeKey || '');
            if (store.has(key)) {
                const duplicate = new Error('duplicate key');
                duplicate.code = 11000;
                throw duplicate;
            }
            const row = {
                ...payload,
                responseStatus: null,
                responseBody: null,
                lockedUntil: payload.lockedUntil || null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            store.set(key, row);
            return cloneRecord(row);
        },
    };
});

const IdempotencyKey = require('../models/IdempotencyKey');
const { executeIdempotent } = require('../services/financial/idempotentRequestExecutor');

describe('financial lockdown idempotency', () => {
    beforeEach(() => {
        IdempotencyKey.__reset();
    });

    it('simulates 50 parallel withdrawal requests and allows only one execution', async () => {
        let withdrawalExecutionCount = 0;

        const req = {
            headers: { 'idempotency-key': 'withdrawal-lockdown-parallel-001' },
            user: { _id: 'user-1' },
        };
        const payload = {
            amount: 100,
            currency: 'INR',
            metadata: { source: 'parallel-stress' },
        };

        const results = await Promise.allSettled(
            Array.from({ length: 50 }).map(() => executeIdempotent({
                req,
                scope: 'withdrawal:request',
                payload,
                requireKey: true,
                handler: async () => {
                    withdrawalExecutionCount += 1;
                    await new Promise((resolve) => setTimeout(resolve, 25));
                    return {
                        withdrawalId: 'wd_lockdown_1',
                        status: 'requested',
                    };
                },
            }))
        );

        expect(withdrawalExecutionCount).toBe(1);

        const successes = results
            .filter((entry) => entry.status === 'fulfilled')
            .map((entry) => entry.value)
            .filter((entry) => Number(entry?.statusCode || 0) === 200);

        expect(successes.length).toBeGreaterThan(0);
        const uniqueWithdrawalIds = new Set(successes.map((entry) => String(entry?.body?.withdrawalId || '')));
        expect(uniqueWithdrawalIds.size).toBe(1);
        expect(uniqueWithdrawalIds.has('wd_lockdown_1')).toBe(true);
    });

    it('rejects same key when payload differs', async () => {
        const req = {
            headers: { 'idempotency-key': 'withdrawal-lockdown-hash-001' },
            user: { _id: 'user-2' },
        };

        await executeIdempotent({
            req,
            scope: 'withdrawal:request',
            payload: { amount: 100, currency: 'INR' },
            requireKey: true,
            handler: async () => ({ ok: true }),
        });

        await expect(executeIdempotent({
            req,
            scope: 'withdrawal:request',
            payload: { amount: 120, currency: 'INR' },
            requireKey: true,
            handler: async () => ({ ok: true }),
        })).rejects.toMatchObject({ statusCode: 409 });
    });
});
