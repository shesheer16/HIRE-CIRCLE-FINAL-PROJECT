const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_ROOT = path.resolve(__dirname, '..', 'uploads', 'storage');
const TOKEN_SECRET = String(
    process.env.SIGNED_URL_SECRET
    || process.env.JWT_SECRET
    || 'local-storage-token-secret'
).trim();

const EXTENSION_BY_MIME = new Map([
    ['video/mp4', '.mp4'],
    ['audio/mp4', '.m4a'],
    ['audio/m4a', '.m4a'],
    ['audio/x-m4a', '.m4a'],
    ['audio/aac', '.aac'],
    ['audio/mpeg', '.mp3'],
    ['audio/mp3', '.mp3'],
    ['audio/wav', '.wav'],
    ['audio/x-wav', '.wav'],
    ['audio/ogg', '.ogg'],
    ['audio/webm', '.webm'],
    ['application/pdf', '.pdf'],
    ['application/msword', '.doc'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
]);

const CONTENT_TYPE_BY_EXTENSION = new Map([
    ['.mp4', 'video/mp4'],
    ['.m4a', 'audio/mp4'],
    ['.aac', 'audio/aac'],
    ['.mp3', 'audio/mpeg'],
    ['.wav', 'audio/wav'],
    ['.ogg', 'audio/ogg'],
    ['.webm', 'audio/webm'],
    ['.pdf', 'application/pdf'],
    ['.doc', 'application/msword'],
    ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.webp', 'image/webp'],
]);

const ensureStorageRoot = () => {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
};

const sanitizePrefix = (value = '') => {
    const raw = String(value || '').replace(/\\/g, '/');
    const sanitized = raw
        .split('/')
        .map((part) => part.trim())
        .filter((part) => part && part !== '.' && part !== '..')
        .join('/');
    return sanitized || 'uploads';
};

const extensionForFile = (filePath, mimeType) => {
    const fromPath = path.extname(String(filePath || '')).toLowerCase();
    if (fromPath) return fromPath;
    const fromMime = EXTENSION_BY_MIME.get(String(mimeType || '').toLowerCase());
    return fromMime || '.bin';
};

const buildObjectKey = ({ filePath, mimeType, prefix = 'uploads' }) => {
    const normalizedPrefix = sanitizePrefix(prefix);
    const extension = extensionForFile(filePath, mimeType);
    const fileName = `${crypto.randomBytes(16).toString('hex')}${extension}`;
    return `${normalizedPrefix}/${fileName}`;
};

const objectKeyToAbsolutePath = (objectKey = '') => {
    const normalizedKey = String(objectKey || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .split('/')
        .filter((part) => part && part !== '.' && part !== '..')
        .join('/');
    if (!normalizedKey) return null;
    return path.join(STORAGE_ROOT, normalizedKey);
};

const isPlaceholderPublicHost = (value = '') => {
    try {
        const parsed = new URL(String(value || '').trim());
        const host = String(parsed.hostname || '').trim().toLowerCase();
        return host === 'example.com' || host.endsWith('.example.com');
    } catch (_error) {
        return false;
    }
};

const resolvePublicUrlBase = () => {
    const apiPublicUrl = String(process.env.API_PUBLIC_URL || '').trim().replace(/\/$/, '');
    if (!apiPublicUrl) return '';
    if (isPlaceholderPublicHost(apiPublicUrl)) return '';
    return apiPublicUrl;
};

const signToken = (payload) => {
    const serialized = JSON.stringify(payload);
    const signature = crypto
        .createHmac('sha256', TOKEN_SECRET)
        .update(serialized)
        .digest('base64url');

    return Buffer.from(JSON.stringify({ payload, signature }), 'utf8').toString('base64url');
};

const verifyToken = (token = '', options = {}) => {
    const allowExpired = Boolean(options?.allowExpired);
    const decoded = Buffer.from(String(token || ''), 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    const payload = parsed?.payload;
    const signature = String(parsed?.signature || '');
    const serialized = JSON.stringify(payload || {});
    const expectedSignature = crypto
        .createHmac('sha256', TOKEN_SECRET)
        .update(serialized)
        .digest('base64url');

    const actualBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
        throw new Error('Invalid signature');
    }

    const expiresAt = Number(payload?.expiresAt || 0);
    if ((!allowExpired) && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) {
        throw new Error('Token expired');
    }

    const objectKey = String(payload?.objectKey || '').trim();
    if (!objectKey) {
        throw new Error('Token missing object key');
    }

    return payload;
};

const buildPublicUrl = (objectKey) => {
    const apiPublicUrl = resolvePublicUrlBase();
    const relative = `/uploads/storage/${String(objectKey || '').replace(/^\/+/, '')}`;
    if (!apiPublicUrl) return relative;
    return `${apiPublicUrl}${relative}`;
};

const getSignedObjectUrl = (objectKey, expiresInSeconds) => {
    const ttlSeconds = Math.max(60, Number.parseInt(expiresInSeconds || process.env.STORAGE_SIGNED_URL_EXPIRY_SECONDS || '900', 10));
    const payload = {
        objectKey: String(objectKey || '').replace(/^\/+/, ''),
        expiresAt: Date.now() + (ttlSeconds * 1000),
    };
    const token = signToken(payload);
    const apiPublicUrl = resolvePublicUrlBase();
    const relative = `/api/upload/private/${encodeURIComponent(token)}`;
    if (!apiPublicUrl) return relative;
    return `${apiPublicUrl}${relative}`;
};

const uploadToLocalStorage = async (filePath, mimeType, options = {}) => {
    ensureStorageRoot();

    const objectKey = buildObjectKey({
        filePath,
        mimeType,
        prefix: String(options.prefix || 'uploads'),
    });
    const destinationPath = objectKeyToAbsolutePath(objectKey);
    if (!destinationPath) {
        throw new Error('Invalid storage path');
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    await fs.promises.copyFile(filePath, destinationPath);

    const signedOnly = String(process.env.STORAGE_SIGNED_URL_ONLY || 'true').toLowerCase() !== 'false';
    if (signedOnly) {
        return getSignedObjectUrl(objectKey, options.signedUrlExpirySeconds);
    }

    return buildPublicUrl(objectKey);
};

const resolveStoredObjectFromSignedToken = async (token) => {
    const payload = verifyToken(token);
    const objectKey = String(payload.objectKey || '').replace(/^\/+/, '');
    const absolutePath = objectKeyToAbsolutePath(objectKey);

    if (!absolutePath || !fs.existsSync(absolutePath)) {
        const error = new Error('Stored object not found');
        error.statusCode = 404;
        throw error;
    }

    const stat = await fs.promises.stat(absolutePath);
    const extension = path.extname(absolutePath).toLowerCase();
    const normalizedObjectKey = String(objectKey || '').trim().toLowerCase();
    const contentType = CONTENT_TYPE_BY_EXTENSION.get(extension)
        || (normalizedObjectKey.startsWith('chat-audio/') ? 'audio/mp4' : 'application/octet-stream');

    return {
        objectKey,
        absolutePath,
        body: fs.createReadStream(absolutePath),
        contentType,
        contentLength: Number(stat.size || 0),
        cacheControl: 'private, max-age=60',
    };
};

const resolveObjectKeyFromUrl = (value = '') => {
    const input = String(value || '').trim();
    if (!input) return null;

    if (!input.includes('://') && !input.startsWith('/')) {
        return input.replace(/^\/+/, '');
    }

    const apiPublicUrl = String(process.env.API_PUBLIC_URL || '').trim().replace(/\/$/, '');
    if (apiPublicUrl && input.startsWith(apiPublicUrl)) {
        const remainder = input.slice(apiPublicUrl.length);
        const tokenMatch = remainder.match(/^\/api\/upload\/private\/([^/?#]+)/);
        if (tokenMatch?.[1]) {
            try {
                const payload = verifyToken(decodeURIComponent(tokenMatch[1]), { allowExpired: true });
                return String(payload.objectKey || '').replace(/^\/+/, '') || null;
            } catch (_error) {
                return null;
            }
        }

        if (remainder.startsWith('/uploads/storage/')) {
            return remainder.replace('/uploads/storage/', '').replace(/^\/+/, '');
        }
    }

    if (input.startsWith('/api/upload/private/')) {
        try {
            const token = decodeURIComponent(input.replace('/api/upload/private/', '').split(/[?#]/)[0]);
            const payload = verifyToken(token, { allowExpired: true });
            return String(payload.objectKey || '').replace(/^\/+/, '') || null;
        } catch (_error) {
            return null;
        }
    }

    if (input.startsWith('/uploads/storage/')) {
        return input.replace('/uploads/storage/', '').replace(/^\/+/, '');
    }

    try {
        const parsed = new URL(input);
        const pathname = String(parsed.pathname || '');
        if (pathname.startsWith('/api/upload/private/')) {
            const token = decodeURIComponent(pathname.replace('/api/upload/private/', '').split('/')[0]);
            const payload = verifyToken(token, { allowExpired: true });
            return String(payload.objectKey || '').replace(/^\/+/, '') || null;
        }
        if (pathname.startsWith('/uploads/storage/')) {
            return pathname.replace('/uploads/storage/', '').replace(/^\/+/, '');
        }
    } catch (_error) {
        return null;
    }

    return null;
};

const deleteStoredObjectByUrl = async (value = '') => {
    const objectKey = resolveObjectKeyFromUrl(value);
    if (!objectKey) return false;

    const absolutePath = objectKeyToAbsolutePath(objectKey);
    if (!absolutePath || !fs.existsSync(absolutePath)) return false;

    await fs.promises.unlink(absolutePath).catch(() => null);
    return true;
};

module.exports = {
    uploadToLocalStorage,
    getSignedObjectUrl,
    resolveStoredObjectFromSignedToken,
    resolveObjectKeyFromUrl,
    deleteStoredObjectByUrl,
};
