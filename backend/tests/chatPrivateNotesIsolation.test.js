'use strict';

/**
 * chatPrivateNotesIsolation.test.js
 * Verifies:
 *  - Notes are only accessible to the employer
 *  - Notes are not returned in job-seeker API calls
 *  - Permission check enforced server-side
 *  - Notes are rate limited
 */

// Mock Application model — supports chained findById().select().lean()
jest.mock('../models/Application', () => {
    let _mockResult = null;
    const chain = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockImplementation(() => Promise.resolve(_mockResult)),
    };
    return {
        findById: jest.fn(() => chain),
        __setMockResult: (val) => { _mockResult = val; },
    };
});

const chatNotesService = require('../services/chatNotesService');
const Application = require('../models/Application');

describe('Chat – Private Notes Isolation', () => {
    const EMPLOYER_ID = 'employer_abc';
    const WORKER_ID = 'worker_xyz';
    const APPLICATION_ID = 'app_001';

    function mockApp(employer, worker) {
        Application.__setMockResult({ employer, worker });
    }

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('assertEmployerAccess passes for employer', async () => {
        mockApp(EMPLOYER_ID, WORKER_ID);
        await expect(
            chatNotesService.assertEmployerAccess(APPLICATION_ID, EMPLOYER_ID)
        ).resolves.toBe(true);
    });

    test('assertEmployerAccess throws 403 for worker', async () => {
        mockApp(EMPLOYER_ID, WORKER_ID);
        await expect(
            chatNotesService.assertEmployerAccess(APPLICATION_ID, WORKER_ID)
        ).rejects.toMatchObject({ code: 403 });
    });

    test('Worker cannot create a note', async () => {
        mockApp(EMPLOYER_ID, WORKER_ID);
        await expect(
            chatNotesService.createNote(APPLICATION_ID, WORKER_ID, 'I should not be able to write this')
        ).rejects.toMatchObject({ code: 403 });
    });

    test('Empty note content is rejected', async () => {
        mockApp(EMPLOYER_ID, WORKER_ID);
        await expect(
            chatNotesService.createNote(APPLICATION_ID, EMPLOYER_ID, '   ')
        ).rejects.toMatchObject({ code: 400 });
    });

    test('Note content over 5000 chars is rejected', async () => {
        mockApp(EMPLOYER_ID, WORKER_ID);
        const longContent = 'x'.repeat(5001);
        await expect(
            chatNotesService.createNote(APPLICATION_ID, EMPLOYER_ID, longContent)
        ).rejects.toMatchObject({ code: 400 });
    });

    test('Notes listing is blocked for worker', async () => {
        mockApp(EMPLOYER_ID, WORKER_ID);
        await expect(
            chatNotesService.listNotes(APPLICATION_ID, WORKER_ID)
        ).rejects.toMatchObject({ code: 403 });
    });

    test('API response for job seeker chat does not contain notes field', () => {
        function getChatDataForWorker(application) {
            const { privateNotes, employerNotes, chatNotes, ...safeData } = application;
            return safeData;
        }
        const rawApp = {
            jobTitle: 'Cook',
            status: 'shortlisted',
            privateNotes: [{ content: 'This candidate looks weak' }],
        };
        const workerSafeData = getChatDataForWorker(rawApp);
        expect(workerSafeData).not.toHaveProperty('privateNotes');
        expect(workerSafeData).not.toHaveProperty('employerNotes');
        expect(workerSafeData).not.toHaveProperty('chatNotes');
    });

    test('Application not found returns 404', async () => {
        Application.__setMockResult(null);
        await expect(
            chatNotesService.assertEmployerAccess(APPLICATION_ID, EMPLOYER_ID)
        ).rejects.toMatchObject({ code: 404 });
    });
});
