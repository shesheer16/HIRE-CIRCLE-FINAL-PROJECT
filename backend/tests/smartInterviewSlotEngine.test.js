jest.mock('axios', () => ({
    post: jest.fn(),
}));

const axios = require('axios');
const { extractSlotsFromTranscript } = require('../services/smartInterviewSlotEngine');

const buildConfirmedSlotState = () => ({
    fullName: 'Lokesh Kumar',
    city: 'Hyderabad',
    primaryRole: 'Driver',
    primarySkills: ['Driving'],
    shiftPreference: 'day',
    expectedSalary: 22000,
    availabilityType: 'full-time',
    certifications: [],
    languages: ['Hindi'],
    vehicleOwned: true,
    licenseType: 'HMV',
    preferredWorkRadius: 10,
});

const buildConfirmedSlotConfidence = () => ({
    fullName: 0.95,
    city: 0.95,
    primaryRole: 0.95,
    primarySkills: 0.95,
    shiftPreference: 0.95,
    expectedSalary: 0.95,
    availabilityType: 0.95,
    certifications: 0.95,
    languages: 0.95,
    vehicleOwned: 0.95,
    licenseType: 0.95,
    preferredWorkRadius: 0.95,
});

describe('smartInterviewSlotEngine', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.GEMINI_API_KEY = 'test-key';
    });

    it('flags ambiguous field when confidence is below threshold', async () => {
        axios.post.mockResolvedValue({
            data: {
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                fullName: 'Lokesh Kumar',
                                city: 'Hyderabad',
                                primaryRole: 'Driver',
                                primarySkills: ['Driving'],
                                totalExperienceYears: null,
                                shiftPreference: 'day',
                                expectedSalary: 22000,
                                availabilityType: 'full-time',
                                certifications: [],
                                languages: ['Hindi'],
                                vehicleOwned: true,
                                licenseType: 'HMV',
                                preferredWorkRadius: 10,
                                confidence: {
                                    fullName: 0.95,
                                    city: 0.93,
                                    primaryRole: 0.9,
                                    primarySkills: 0.88,
                                    totalExperienceYears: 0.4,
                                    shiftPreference: 0.8,
                                    expectedSalary: 0.82,
                                    availabilityType: 0.84,
                                    certifications: 0.7,
                                    languages: 0.8,
                                    vehicleOwned: 0.8,
                                    licenseType: 0.75,
                                    preferredWorkRadius: 0.7,
                                },
                            }),
                        }],
                    },
                }],
            },
        });

        const result = await extractSlotsFromTranscript(
            'I am a driver and I worked for some time',
            buildConfirmedSlotState(),
            buildConfirmedSlotConfidence()
        );

        expect(result.slotState.primaryRole).toBe('Driver');
        expect(result.slotConfidence.totalExperienceYears).toBeCloseTo(0.35);
        expect(result.ambiguousFields).toContain('totalExperienceYears');
        expect(result.interviewComplete).toBe(false);
        expect(result.missingSlot).toBe('totalExperienceYears');
    });

    it('retries once when model returns invalid JSON', async () => {
        axios.post
            .mockResolvedValueOnce({
                data: {
                    candidates: [{
                        content: {
                            parts: [{ text: 'not-json-response' }],
                        },
                    }],
                },
            })
            .mockResolvedValueOnce({
                data: {
                    candidates: [{
                        content: {
                            parts: [{
                                text: JSON.stringify({
                                    fullName: 'Lokesh Kumar',
                                    city: 'Hyderabad',
                                    primaryRole: 'Driver',
                                    primarySkills: ['Driving'],
                                    totalExperienceYears: 3,
                                    shiftPreference: 'day',
                                    expectedSalary: 22000,
                                    availabilityType: 'full-time',
                                    certifications: [],
                                    languages: ['Hindi'],
                                    vehicleOwned: true,
                                    licenseType: 'HMV',
                                    preferredWorkRadius: 10,
                                    confidence: {
                                        fullName: 0.95,
                                        city: 0.95,
                                        primaryRole: 0.95,
                                        primarySkills: 0.95,
                                        totalExperienceYears: 0.95,
                                        shiftPreference: 0.95,
                                        expectedSalary: 0.95,
                                        availabilityType: 0.95,
                                        certifications: 0,
                                        languages: 0.95,
                                        vehicleOwned: 0.95,
                                        licenseType: 0.95,
                                        preferredWorkRadius: 0.95,
                                    },
                                }),
                            }],
                        },
                    }],
                },
            });

        const result = await extractSlotsFromTranscript(
            'I have 3 years of experience',
            buildConfirmedSlotState(),
            buildConfirmedSlotConfidence()
        );

        expect(axios.post).toHaveBeenCalledTimes(2);
        expect(result.slotState.totalExperienceYears).toBe(3);
        expect(result.ambiguousFields).toEqual([]);
    });
});
