const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { resolveRegionConfig } = require('../config/region');
const { getRegionalS3Bucket } = require('../config/multiRegion');

const regionConfig = resolveRegionConfig();
const storageRegion = regionConfig.region;
const staticAssetsBaseUrl = regionConfig.staticAssetsBaseUrl
    || String(process.env.ASSET_PUBLIC_BASE_URL || process.env.AWS_CLOUDFRONT_URL || '').trim();
const bucketName = String(getRegionalS3Bucket() || process.env.AWS_BUCKET_NAME || '').trim();

const s3Client = new S3Client({
    region: storageRegion,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

const SIGNED_URL_SECRET = String(process.env.SIGNED_URL_SECRET || '').trim();

const resolveObjectKey = (filePath, objectPrefix) => {
    const normalizedPrefix = String(objectPrefix || 'uploads').replace(/^\/+|\/+$/g, '') || 'uploads';
    const extension = path.extname(String(filePath || '')).toLowerCase() || '.bin';
    const fileName = `${crypto.randomBytes(16).toString('hex')}${extension}`;
    return `${normalizedPrefix}/${fileName}`;
};

const buildPutParams = ({ key, fileStream, mimetype }) => {
    const params = {
        Bucket: bucketName,
        Key: key,
        Body: fileStream,
        ContentType: mimetype,
    };

    const acl = String(process.env.S3_OBJECT_ACL || 'private').trim().toLowerCase();
    if (acl && acl !== 'disabled') {
        params.ACL = acl;
    }

    return params;
};

const signToken = (payload) => {
    if (!SIGNED_URL_SECRET) {
        throw new Error('SIGNED_URL_SECRET is required for private object URLs');
    }
    const serialized = JSON.stringify(payload);
    const signature = crypto
        .createHmac('sha256', SIGNED_URL_SECRET)
        .update(serialized)
        .digest('base64url');

    return Buffer.from(JSON.stringify({ payload, signature }), 'utf8').toString('base64url');
};

const verifyToken = (token) => {
    if (!SIGNED_URL_SECRET) {
        throw new Error('SIGNED_URL_SECRET is required for private object URLs');
    }

    const decoded = Buffer.from(String(token || ''), 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    const payload = parsed?.payload;
    const signature = String(parsed?.signature || '');
    const serialized = JSON.stringify(payload || {});

    const expected = crypto
        .createHmac('sha256', SIGNED_URL_SECRET)
        .update(serialized)
        .digest('base64url');

    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
        throw new Error('Invalid signature');
    }

    const expiresAt = Number(payload?.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error('Token expired');
    }

    const objectKey = String(payload?.objectKey || '').trim();
    if (!objectKey) {
        throw new Error('Token missing object key');
    }

    return payload;
};

const getSignedObjectUrl = (objectKey, expiresInSeconds) => {
    const ttlSeconds = Math.max(60, Number.parseInt(expiresInSeconds || process.env.S3_SIGNED_URL_EXPIRY_SECONDS || '900', 10));
    const payload = {
        objectKey: String(objectKey || '').replace(/^\/+/, ''),
        expiresAt: Date.now() + (ttlSeconds * 1000),
    };
    const token = signToken(payload);

    const apiPublicUrl = String(process.env.API_PUBLIC_URL || '').trim().replace(/\/$/, '');
    const relativePath = `/api/upload/private/${encodeURIComponent(token)}`;

    if (!apiPublicUrl) {
        return relativePath;
    }

    return `${apiPublicUrl}${relativePath}`;
};

const resolveObjectFromSignedToken = async (token) => {
    const payload = verifyToken(token);

    const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: payload.objectKey,
    });

    const result = await s3Client.send(command);
    return {
        objectKey: payload.objectKey,
        body: result.Body,
        contentType: result.ContentType || 'application/octet-stream',
        contentLength: result.ContentLength || null,
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
        const tokenPath = input.slice(apiPublicUrl.length);
        const tokenMatch = tokenPath.match(/^\/api\/upload\/private\/([^/?#]+)/);
        if (tokenMatch?.[1]) {
            try {
                const payload = verifyToken(decodeURIComponent(tokenMatch[1]));
                return String(payload?.objectKey || '').replace(/^\/+/, '') || null;
            } catch (_error) {
                return null;
            }
        }
    }

    try {
        const parsed = new URL(input);
        const pathname = String(parsed.pathname || '').replace(/^\/+/, '');
        if (!pathname) return null;

        if (bucketName && pathname.startsWith(`${bucketName}/`)) {
            return pathname.slice(`${bucketName}/`.length);
        }
        return pathname;
    } catch (_error) {
        return null;
    }
};

const deleteObjectByUrl = async (value = '') => {
    const objectKey = resolveObjectKeyFromUrl(value);
    if (!objectKey || !bucketName) return false;

    await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
    }));

    return true;
};

const uploadToS3 = async (filePath, mimetype, options = {}) => {
    const objectPrefix = String(options.prefix || 'uploads').trim();
    const objectKey = resolveObjectKey(filePath, objectPrefix);
    const fileStream = fs.createReadStream(filePath);

    const putParams = buildPutParams({ key: objectKey, fileStream, mimetype });

    try {
        await s3Client.send(new PutObjectCommand(putParams));
    } catch (error) {
        if (String(error?.name || '').toLowerCase() === 'accesscontrollistnotsupported' && putParams.ACL) {
            delete putParams.ACL;
            await s3Client.send(new PutObjectCommand(putParams));
        } else {
            logger.warn({ event: 's3_upload_failed', message: error?.message || error });
            throw error;
        }
    }

    const signedOnly = String(process.env.S3_SIGNED_URL_ONLY || 'true').toLowerCase() !== 'false';
    if (signedOnly) {
        return getSignedObjectUrl(objectKey, options.signedUrlExpirySeconds);
    }

    if (staticAssetsBaseUrl) {
        return `${String(staticAssetsBaseUrl).replace(/\/$/, '')}/${objectKey}`;
    }

    return `https://${bucketName}.s3.${storageRegion}.amazonaws.com/${objectKey}`;
};

module.exports = {
    uploadToS3,
    getSignedObjectUrl,
    resolveObjectFromSignedToken,
    deleteObjectByUrl,
    s3Client,
};
