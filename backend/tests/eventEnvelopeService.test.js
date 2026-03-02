jest.mock('../models/EventEnvelope', () => ({
    create: jest.fn(),
    find: jest.fn(),
    deleteMany: jest.fn(),
}));

jest.mock('../models/ArchivedEventEnvelope', () => ({
    insertMany: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
}));

jest.mock('../utils/requestContext', () => ({
    getRequestContext: jest.fn(() => ({
        correlationId: 'test-correlation-id',
        appVersion: '1.2.3',
        region: 'IN-HYD',
    })),
}));

const EventEnvelope = require('../models/EventEnvelope');
const ArchivedEventEnvelope = require('../models/ArchivedEventEnvelope');
const {
    emitEventEnvelope,
    buildEnvelopePayload,
    sanitizeMetadata,
} = require('../services/eventEnvelopeService');

describe('eventEnvelopeService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('sanitizes metadata and injects context defaults', async () => {
        EventEnvelope.create.mockImplementation(async (payload) => payload);

        const payload = buildEnvelopePayload({
            eventType: 'user signup',
            actorId: 'u-1',
            metadata: {
                email: 'person@example.com',
                nested: {
                    token: 'abc',
                },
            },
            source: 'test',
        });

        expect(payload.eventType).toBe('USER_SIGNUP');
        expect(payload.region).toBe('IN-HYD');
        expect(payload.appVersion).toBe('1.2.3');
        expect(payload.metadata.email).toBe('[REDACTED]');
        expect(payload.metadata.nested.token).toBe('[REDACTED]');

        const created = await emitEventEnvelope({
            eventType: 'user signup',
            actorId: 'u-1',
            metadata: {
                email: 'person@example.com',
            },
        });

        expect(created.eventType).toBe('USER_SIGNUP');
        expect(created.metadata.email).toBe('[REDACTED]');
        expect(EventEnvelope.create).toHaveBeenCalledTimes(1);
    });

    it('masks pii recursively', () => {
        const masked = sanitizeMetadata({
            phone: '+919999999999',
            profile: {
                name: 'Lokesh',
                notes: 'ok',
            },
        });

        expect(masked.phone).toBe('[REDACTED]');
        expect(masked.profile.name).toBe('[REDACTED]');
        expect(masked.profile.notes).toBe('ok');
    });
});
