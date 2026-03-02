const { mergeSlots } = require('../services/smartInterviewSlotEngine');

describe('smart interview profile write security', () => {
    it('does not allow protected or privilege fields from model output', () => {
        const result = mergeSlots({
            transcript: 'My name is Priya and I work as warehouse staff in Delhi.',
            existingSlotState: {},
            existingSlotConfidence: {},
            extracted: {
                fullName: 'Priya',
                primaryRole: 'warehouse staff',
                role: 'admin',
                isAdmin: true,
                permissions: ['*'],
                accountStatus: 'verified',
                confidence: {
                    fullName: 0.95,
                    primaryRole: 0.9,
                },
            },
        });

        expect(result.slotState.fullName).toBe('Priya');
        expect(result.slotState.primaryRole).toBe('warehouse staff');
        expect(result.slotState.role).toBeUndefined();
        expect(result.slotState.isAdmin).toBeUndefined();
        expect(result.slotState.permissions).toBeUndefined();
        expect(result.rejectedFields).toEqual(expect.arrayContaining([
            'role',
            'isAdmin',
            'permissions',
            'accountStatus',
        ]));
    });

    it('sanitizes markup/script-like values before merge', () => {
        const result = mergeSlots({
            transcript: 'My name is script alert one Anita and I live in Bengaluru.',
            existingSlotState: {},
            existingSlotConfidence: {},
            extracted: {
                fullName: '<script>alert(1)</script> Anita',
                city: '<img src=x onerror=alert(1)> Bengaluru',
                confidence: {
                    fullName: 0.9,
                    city: 0.9,
                },
            },
        });

        expect(result.slotState.fullName).toBe('alert(1) Anita');
        expect(result.slotState.city).toBe('Bengaluru');
    });

    it('prevents overwrite when extracted value is not transcript-backed', () => {
        const result = mergeSlots({
            transcript: 'I am still Ravi from Hyderabad',
            existingSlotState: {
                fullName: 'Ravi',
                city: 'Hyderabad',
            },
            existingSlotConfidence: {
                fullName: 0.95,
                city: 0.95,
            },
            extracted: {
                fullName: 'Mallory',
                city: 'UnknownCity',
                confidence: {
                    fullName: 0.99,
                    city: 0.99,
                },
            },
        });

        expect(result.slotState.fullName).toBe('Ravi');
        expect(result.slotState.city).toBe('Hyderabad');
        expect(result.rejectedFields).toEqual(expect.arrayContaining(['fullName', 'city']));
    });
});
