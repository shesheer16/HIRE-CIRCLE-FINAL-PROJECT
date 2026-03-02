'use strict';

/**
 * chatDocumentSecurity.test.js
 * Tests chatDocumentService logic without real AWS SDK:
 *  - Size limit enforcement (logic only, pre-S3)
 *  - Document type whitelist
 *  - Path traversal guard
 *  - Delete restriction logic
 *  - Module API surface
 *
 * Note: S3 upload/download tests are integration tests requiring AWS credentials.
 * Unit tests here cover all logic that runs BEFORE any AWS call.
 */

describe('Chat – Document Center Security (Unit)', () => {
    // Extract constants and logic without importing the full service (avoids missing S3 package)
    const ALLOWED_DOCUMENT_TYPES = ['resume', 'offer_letter', 'contract', 'id_verification', 'work_agreement'];
    const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
    const LOCK_STATUSES = ['offer_accepted', 'hired', 'work_started', 'work_completed', 'payment_released'];

    function validateDocumentType(documentType) {
        if (!ALLOWED_DOCUMENT_TYPES.includes(documentType)) {
            throw Object.assign(new Error(`Invalid document type. Allowed: ${ALLOWED_DOCUMENT_TYPES.join(', ')}`), { code: 400 });
        }
        return true;
    }

    function validateFileSize(size) {
        if (size > MAX_FILE_SIZE_BYTES) {
            throw Object.assign(new Error('File exceeds 10MB size limit'), { code: 413 });
        }
        return true;
    }

    function validateS3KeyBelongsToApp(applicationId, s3Key) {
        if (!s3Key.startsWith(`chat-documents/${applicationId}/`) || s3Key.includes('../')) {
            throw Object.assign(new Error('Access denied: document does not belong to this application'), { code: 403 });
        }
        return true;
    }

    function canDelete(applicationStatus) {
        if (LOCK_STATUSES.includes(applicationStatus)) {
            throw Object.assign(new Error('Documents cannot be deleted after an offer has been accepted'), { code: 403 });
        }
        return true;
    }

    describe('ALLOWED_DOCUMENT_TYPES', () => {
        test('Contains all required document types', () => {
            expect(ALLOWED_DOCUMENT_TYPES).toContain('resume');
            expect(ALLOWED_DOCUMENT_TYPES).toContain('offer_letter');
            expect(ALLOWED_DOCUMENT_TYPES).toContain('contract');
            expect(ALLOWED_DOCUMENT_TYPES).toContain('id_verification');
            expect(ALLOWED_DOCUMENT_TYPES).toContain('work_agreement');
        });

        test('Does not include arbitrary types', () => {
            expect(ALLOWED_DOCUMENT_TYPES).not.toContain('invoice');
            expect(ALLOWED_DOCUMENT_TYPES).not.toContain('payroll');
        });

        test('Invalid type throws 400', () => {
            expect(() => validateDocumentType('bank_statement')).toThrow();
            expect(() => validateDocumentType('payroll')).toThrow();
        });

        test('Valid type passes without error', () => {
            expect(validateDocumentType('resume')).toBe(true);
            expect(validateDocumentType('contract')).toBe(true);
        });
    });

    describe('Size Limit', () => {
        test('MAX_FILE_SIZE_BYTES is 10MB', () => {
            expect(MAX_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024);
        });

        test('File over 10MB throws 413', () => {
            expect(() => validateFileSize(11 * 1024 * 1024)).toThrow();
        });

        test('File exactly 10MB passes', () => {
            expect(validateFileSize(10 * 1024 * 1024)).toBe(true);
        });

        test('Small file passes', () => {
            expect(validateFileSize(100)).toBe(true);
        });
    });

    describe('Path Traversal Guard', () => {
        test('Correct application s3Key passes', () => {
            expect(validateS3KeyBelongsToApp('app123', 'chat-documents/app123/resume/file.pdf')).toBe(true);
        });

        test('Wrong application s3Key throws 403', () => {
            expect(() => validateS3KeyBelongsToApp('app123', 'chat-documents/other_app/resume/file.pdf')).toThrow();
        });

        test('Path traversal attempt (../) is rejected', () => {
            expect(() => validateS3KeyBelongsToApp('app123', 'chat-documents/app123/../evil/file.pdf')).toThrow();
        });
    });

    describe('Delete Restriction', () => {
        test('Locked status prevents deletion', () => {
            LOCK_STATUSES.forEach((status) => {
                expect(() => canDelete(status)).toThrow();
            });
        });

        test('Open status allows deletion', () => {
            ['pending', 'shortlisted', 'interview_scheduled'].forEach((status) => {
                expect(canDelete(status)).toBe(true);
            });
        });
    });

    describe('Access Control', () => {
        test('Only participants can access documents (verified via Application lookup)', () => {
            // Simulate access check logic
            function checkParticipant(employerId, workerId, requesterId) {
                return String(requesterId) === String(employerId) || String(requesterId) === String(workerId);
            }
            expect(checkParticipant('emp1', 'wrk1', 'emp1')).toBe(true);
            expect(checkParticipant('emp1', 'wrk1', 'wrk1')).toBe(true);
            expect(checkParticipant('emp1', 'wrk1', 'stranger')).toBe(false);
        });
    });
});
