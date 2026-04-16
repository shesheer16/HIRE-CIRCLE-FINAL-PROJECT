const crypto = require('crypto');

const buildKey = () => {
    const source = String(process.env.PLATFORM_ENCRYPTION_SECRET || '').trim();
    if (!source) {
        throw new Error('PLATFORM_ENCRYPTION_SECRET is required');
    }
    return crypto.createHash('sha256').update(source).digest();
};

const ALGORITHM = 'aes-256-gcm';
let keyBuffer = null;

const getKey = () => {
    if (!keyBuffer) {
        keyBuffer = buildKey();
    }
    return keyBuffer;
};

const encryptValue = (plainText = '') => {
    const value = String(plainText || '');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        encrypted: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
    };
};

const decryptValue = ({ encrypted, iv, tag } = {}) => {
    if (!encrypted || !iv || !tag) {
        return '';
    }

    const decipher = crypto.createDecipheriv(
        ALGORITHM,
        getKey(),
        Buffer.from(String(iv), 'base64')
    );
    decipher.setAuthTag(Buffer.from(String(tag), 'base64'));

    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(String(encrypted), 'base64')),
        decipher.final(),
    ]);

    return decrypted.toString('utf8');
};

module.exports = {
    encryptValue,
    decryptValue,
};
