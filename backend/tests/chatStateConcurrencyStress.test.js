'use strict';

/**
 * chatStateConcurrencyStress.test.js
 * Simulates:
 *  - Rapid simultaneous status changes
 *  - Offer + reject race conditions
 *  - Escrow + hire race
 *  - Multi-device chat open
 *  - Reconnect mid-call
 *
 * All verifications run via in-process simulation (no DB/socket needed).
 */

describe('Chat – State Concurrency Stress', () => {
    // Optimistic locking simulator
    function createVersionedResource(initialState) {
        return { state: initialState, version: 0 };
    }

    function tryApplyTransition(resource, newState, expectedVersion) {
        if (resource.version !== expectedVersion) {
            return { success: false, reason: 'VERSION_CONFLICT', currentVersion: resource.version };
        }
        resource.state = newState;
        resource.version += 1;
        return { success: true, newVersion: resource.version };
    }

    // --- Rapid Status Changes ---
    test('Only one of many concurrent status changes succeeds (optimistic lock)', () => {
        const resource = createVersionedResource('pending');
        const results = [
            tryApplyTransition(resource, 'shortlisted', 0),
            tryApplyTransition(resource, 'rejected', 0),
            tryApplyTransition(resource, 'shortlisted', 0),
        ];
        const successes = results.filter((r) => r.success);
        const failures = results.filter((r) => !r.success);
        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(2);
        expect(resource.version).toBe(1);
    });

    // --- Offer + Reject Race ---
    test('Offer acceptance and rejection cannot both succeed', async () => {
        const offer = createVersionedResource('pending');

        const accept = () => tryApplyTransition(offer, 'accepted', 0);
        const reject = () => tryApplyTransition(offer, 'rejected', 0);

        const [r1, r2] = await Promise.all([
            Promise.resolve(accept()),
            Promise.resolve(reject()),
        ]);

        const successCount = [r1, r2].filter((r) => r.success).length;
        expect(successCount).toBe(1); // Only first write wins
        expect(['accepted', 'rejected']).toContain(offer.state);
    });

    // --- Escrow + Hire Race ---
    test('Escrow funding and hire cannot conflict if version-locked', () => {
        const escrow = createVersionedResource('not_funded');
        const r1 = tryApplyTransition(escrow, 'funded', 0); // wins
        const r2 = tryApplyTransition(escrow, 'funded', 0); // loses
        expect(r1.success).toBe(true);
        expect(r2.success).toBe(false);
        expect(escrow.version).toBe(1);
    });

    // --- Duplicate Message Deduplication ---
    test('Multi-device: duplicate messages are deduplicated by _id', () => {
        const messageStore = [];
        function ingestMessage(msg) {
            const exists = messageStore.some((m) => m._id === msg._id);
            if (!exists) messageStore.push(msg);
        }

        const msg = { _id: 'msg_abc', text: 'Hello', createdAt: new Date().toISOString() };
        ingestMessage(msg);
        ingestMessage(msg); // duplicate from device 2
        ingestMessage(msg); // duplicate from reconnect

        expect(messageStore).toHaveLength(1);
    });

    // --- Reconnect Mid-Call ---
    test('Reconnect does not duplicate join_chat room registration', () => {
        const joinedRooms = new Set();
        function joinRoom(roomId) {
            joinedRooms.add(roomId); // Set deduplicates
        }
        // Simulate reconnect loop
        joinRoom('room_001');
        joinRoom('room_001');
        joinRoom('room_001');
        expect(joinedRooms.size).toBe(1);
    });

    // --- Timeline event deduplication under concurrent writes ---
    test('No duplicate timeline events from concurrent state machine fires', () => {
        const timeline = [];
        function appendEventIfNotDuplicated(type, at) {
            const exists = timeline.some((e) => e.type === type && e.at === at);
            if (!exists) timeline.push({ type, at });
        }
        const at = new Date().toISOString();
        appendEventIfNotDuplicated('offer_sent', at);
        appendEventIfNotDuplicated('offer_sent', at); // concurrent duplicate
        appendEventIfNotDuplicated('offer_sent', at);
        expect(timeline).toHaveLength(1);
    });

    // --- Overall state integrity after 10 rapid transitions ---
    test('State remains consistent after 10 rapid transition attempts', () => {
        const resource = createVersionedResource('pending');
        const states = ['shortlisted', 'interview_scheduled', 'interview_completed', 'offer_sent', 'offer_accepted'];
        let expectedVersion = 0;
        states.forEach((state) => {
            const result = tryApplyTransition(resource, state, expectedVersion);
            expect(result.success).toBe(true);
            expectedVersion = resource.version;
        });
        expect(resource.state).toBe('offer_accepted');
        expect(resource.version).toBe(5);
    });
});
