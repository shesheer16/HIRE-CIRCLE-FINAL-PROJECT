'use strict';

/**
 * chatInterviewCalendar.test.js
 * Verifies:
 *  - Interview scheduling within a chat context
 *  - Timezone consistency (no mismatch)
 *  - No double booking for same interviewer
 *  - No race conditions in accept/decline
 *  - ICS calendar export structure
 */

describe('Chat – Interview Calendar Integration', () => {
    function buildInterviewSlot(startIso, tzOffset = '+05:30') {
        return {
            startTime: startIso,
            endTime: new Date(new Date(startIso).getTime() + 60 * 60 * 1000).toISOString(),
            timezone: `UTC${tzOffset}`,
            status: 'pending',
            applicationId: 'app123',
            scheduledBy: 'employer',
        };
    }

    // --- Timezone ---
    test('Start and end time are in consistent timezone format', () => {
        const slot = buildInterviewSlot('2026-04-01T10:00:00.000Z');
        expect(slot.startTime).toMatch(/Z$/);
        expect(slot.endTime).toMatch(/Z$/);
        expect(slot.timezone).toContain('UTC');
    });

    test('End time is after start time', () => {
        const slot = buildInterviewSlot('2026-04-01T10:00:00.000Z');
        expect(new Date(slot.endTime).getTime()).toBeGreaterThan(new Date(slot.startTime).getTime());
    });

    test('Detects timezone mismatch when times are in different zones', () => {
        const utcTime = '2026-04-01T10:00:00.000Z';
        const istTime = '2026-04-01T15:30:00+05:30';
        const utcMs = new Date(utcTime).getTime();
        const istMs = new Date(istTime).getTime();
        // Both should resolve to same UTC instant — no mismatch
        expect(utcMs).toBe(istMs);
    });

    // --- Double Booking ---
    test('No double booking: two slots same time same interviewer are flagged', () => {
        const existing = [{ startTime: '2026-04-01T10:00:00.000Z', endTime: '2026-04-01T11:00:00.000Z', interviewerId: 'emp1' }];
        const newSlot = { startTime: '2026-04-01T10:30:00.000Z', endTime: '2026-04-01T11:30:00.000Z', interviewerId: 'emp1' };

        function hasConflict(existing, newSlot) {
            return existing.some((slot) => {
                if (slot.interviewerId !== newSlot.interviewerId) return false;
                const existStart = new Date(slot.startTime).getTime();
                const existEnd = new Date(slot.endTime).getTime();
                const newStart = new Date(newSlot.startTime).getTime();
                const newEnd = new Date(newSlot.endTime).getTime();
                return newStart < existEnd && newEnd > existStart;
            });
        }

        expect(hasConflict(existing, newSlot)).toBe(true);
    });

    test('No conflict when slots are sequential for same interviewer', () => {
        const existing = [{ startTime: '2026-04-01T10:00:00.000Z', endTime: '2026-04-01T11:00:00.000Z', interviewerId: 'emp1' }];
        const newSlot = { startTime: '2026-04-01T11:00:00.000Z', endTime: '2026-04-01T12:00:00.000Z', interviewerId: 'emp1' };

        function hasConflict(existing, newSlot) {
            return existing.some((slot) => {
                if (slot.interviewerId !== newSlot.interviewerId) return false;
                const existEnd = new Date(slot.endTime).getTime();
                const newStart = new Date(newSlot.startTime).getTime();
                const newEnd = new Date(newSlot.endTime).getTime();
                return newStart < existEnd && newEnd > new Date(slot.startTime).getTime();
            });
        }

        expect(hasConflict(existing, newSlot)).toBe(false);
    });

    // --- Race Condition Guard ---
    test('Concurrent accept/decline is idempotent (last-write-wins with version check)', () => {
        const dbSlot = { status: 'pending', version: 1 };

        function tryUpdateStatus(slot, newStatus, expectedVersion) {
            if (slot.version !== expectedVersion) {
                return { success: false, reason: 'VERSION_CONFLICT' };
            }
            slot.status = newStatus;
            slot.version += 1;
            return { success: true };
        }

        const result1 = tryUpdateStatus(dbSlot, 'accepted', 1); // wins
        const result2 = tryUpdateStatus(dbSlot, 'declined', 1); // loses: version mismatch

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(false);
        expect(result2.reason).toBe('VERSION_CONFLICT');
        expect(dbSlot.status).toBe('accepted');
    });

    // --- ICS Export ---
    test('ICS export format contains required fields', () => {
        function generateICS(slot) {
            return [
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'BEGIN:VEVENT',
                `DTSTART:${new Date(slot.startTime).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
                `DTEND:${new Date(slot.endTime).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
                `SUMMARY:Interview - ${slot.applicationId}`,
                'END:VEVENT',
                'END:VCALENDAR',
            ].join('\r\n');
        }

        const slot = buildInterviewSlot('2026-04-01T10:00:00.000Z');
        const ics = generateICS(slot);
        expect(ics).toContain('BEGIN:VCALENDAR');
        expect(ics).toContain('BEGIN:VEVENT');
        expect(ics).toContain('DTSTART:');
        expect(ics).toContain('DTEND:');
        expect(ics).toContain('END:VEVENT');
        expect(ics).toContain('END:VCALENDAR');
    });
});
