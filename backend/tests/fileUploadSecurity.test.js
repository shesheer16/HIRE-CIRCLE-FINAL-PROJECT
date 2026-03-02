const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    ensureExtensionMatchesMime,
    isValidAttachmentSignature,
    isValidMp4Signature,
    runVirusScanHook,
} = require('../services/uploadSecurityService');

jest.setTimeout(20000);

describe('file upload security guards', () => {
    let tempDir;
    let originalNodeEnv;
    let originalVirusProvider;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-sec-'));
        originalNodeEnv = process.env.NODE_ENV;
        originalVirusProvider = process.env.VIRUS_SCAN_PROVIDER;
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        process.env.VIRUS_SCAN_PROVIDER = originalVirusProvider;
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('fails closed in production when virus scanner is not configured', async () => {
        process.env.NODE_ENV = 'production';
        process.env.VIRUS_SCAN_PROVIDER = 'placeholder';

        await expect(runVirusScanHook({
            filePath: '/tmp/non-existent-file',
            mimeType: 'image/jpeg',
            originalName: 'avatar.jpg',
            correlationId: 'upload-security-test',
        })).rejects.toMatchObject({ statusCode: 503 });
    });

    it('detects executable/mime spoof attempts and rejects SVG/script payload signatures', () => {
        const disguisedExePath = path.join(tempDir, 'avatar.jpg');
        fs.writeFileSync(disguisedExePath, Buffer.from('MZP\x00\x02\x00\x00\x00', 'binary'));

        const allowedMap = new Map([
            ['image/jpeg', ['.jpg', '.jpeg']],
            ['image/png', ['.png']],
        ]);

        expect(ensureExtensionMatchesMime('avatar.jpg', 'image/jpeg', allowedMap)).toBe(true);
        expect(isValidAttachmentSignature(disguisedExePath, 'image/jpeg')).toBe(false);

        const svgPath = path.join(tempDir, 'vector.svg');
        fs.writeFileSync(svgPath, '<svg><script>alert(1)</script></svg>', 'utf8');
        expect(ensureExtensionMatchesMime('vector.svg', 'image/svg+xml', allowedMap)).toBe(false);
        expect(isValidAttachmentSignature(svgPath, 'image/svg+xml')).toBe(false);

        expect(ensureExtensionMatchesMime('avatar.png', 'image/jpeg', allowedMap)).toBe(false);
        expect(ensureExtensionMatchesMime('../avatar.jpg', 'image/jpeg', allowedMap)).toBe(true);
    });

    it('validates mp4 signature and rejects non-video payloads', () => {
        const fakeMp4Path = path.join(tempDir, 'video.mp4');
        fs.writeFileSync(fakeMp4Path, Buffer.from('00000020ftypisom', 'utf8'));
        expect(isValidMp4Signature(fakeMp4Path)).toBe(true);

        const nonVideoPath = path.join(tempDir, 'video-bad.mp4');
        fs.writeFileSync(nonVideoPath, Buffer.from('not-an-mp4-header', 'utf8'));
        expect(isValidMp4Signature(nonVideoPath)).toBe(false);
    });
});
