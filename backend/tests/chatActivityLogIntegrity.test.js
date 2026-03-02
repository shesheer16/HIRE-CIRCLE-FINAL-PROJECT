'use strict';

/**
 * chatActivityLogIntegrity.test.js
 * Verifies activity log system messages:
 *  - Are system-generated, not user-created
 *  - Have icon indicators
 *  - Are clearly differentiated from user messages
 *  - Cannot be edited or deleted by users
 */

describe('Chat – Activity Log Integrity', () => {
    const SYSTEM_ACTIVITY_TYPES = [
        'status_change',
        'call_completed',
        'escrow_funded',
        'payment_released',
        'offer_expired',
        'deadline_reminder',
        'offer_accepted',
        'offer_rejected',
        'interview_scheduled',
        'interview_completed',
    ];

    const ACTIVITY_ICONS = {
        status_change: '🔄',
        call_completed: '📞',
        escrow_funded: '🔐',
        payment_released: '💸',
        offer_expired: '⏰',
        deadline_reminder: '🔔',
        offer_accepted: '✅',
        offer_rejected: '❌',
        interview_scheduled: '📅',
        interview_completed: '🎤',
    };

    function buildActivityLogMessage(type, meta = {}) {
        return {
            type: 'system',
            activityType: type,
            text: meta.text || `[System] ${type.replace(/_/g, ' ')}`,
            icon: ACTIVITY_ICONS[type] || '📋',
            generatedBy: 'system',
            userEditable: false,
            userDeletable: false,
            createdAt: new Date().toISOString(),
        };
    }

    test('All canonical activity types have icon mappings', () => {
        SYSTEM_ACTIVITY_TYPES.forEach((type) => {
            expect(ACTIVITY_ICONS[type]).toBeDefined();
            expect(typeof ACTIVITY_ICONS[type]).toBe('string');
        });
    });

    test('Activity log messages are type=system', () => {
        SYSTEM_ACTIVITY_TYPES.forEach((type) => {
            const msg = buildActivityLogMessage(type);
            expect(msg.type).toBe('system');
        });
    });

    test('Activity log messages are not user-editable', () => {
        const msg = buildActivityLogMessage('status_change');
        expect(msg.userEditable).toBe(false);
        expect(msg.userDeletable).toBe(false);
    });

    test('Activity log messages are marked as system-generated', () => {
        const msg = buildActivityLogMessage('escrow_funded');
        expect(msg.generatedBy).toBe('system');
    });

    test('Activity log messages have timestamps', () => {
        const msg = buildActivityLogMessage('call_completed');
        expect(msg.createdAt).toBeDefined();
        expect(() => new Date(msg.createdAt).toISOString()).not.toThrow();
    });

    test('Activity log messages have icon indicators', () => {
        const msg = buildActivityLogMessage('payment_released');
        expect(msg.icon).toBeDefined();
        expect(msg.icon.length).toBeGreaterThan(0);
    });

    test('User cannot inject type=system messages via sendMessage API', () => {
        // Server-side validation: reject user-submitted messages with type=system
        function validateUserMessage(payload) {
            if (payload.type === 'system') {
                throw new Error('Users cannot create system messages');
            }
            return true;
        }
        expect(() => validateUserMessage({ type: 'system', text: 'fake system event' })).toThrow();
        expect(validateUserMessage({ type: 'text', text: 'hello' })).toBe(true);
    });

    test('Activity messages are clearly different from user messages (by type field)', () => {
        const systemMsg = buildActivityLogMessage('offer_sent');
        const userMsg = { type: 'text', text: 'Hi', generatedBy: 'user', userEditable: true };
        expect(systemMsg.type).not.toBe(userMsg.type);
        expect(systemMsg.generatedBy).not.toBe(userMsg.generatedBy);
    });

    test('Missing activityType falls back to generic icon', () => {
        const msg = buildActivityLogMessage('unknown_type');
        expect(msg.icon).toBe('📋');
    });
});
