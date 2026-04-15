const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isPlainObject = (value) => (
    Object.prototype.toString.call(value) === '[object Object]'
);

const shouldStripKey = (key) => {
    const normalized = String(key || '').trim();
    if (!normalized) return true;
    if (DANGEROUS_KEYS.has(normalized)) return true;
    if (normalized.startsWith('$')) return true;
    if (normalized.includes('.')) return true;
    return false;
};

const sanitizePayload = (value) => {
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            value[index] = sanitizePayload(value[index]);
        }
        return value;
    }

    if (!isPlainObject(value)) {
        return value;
    }

    Object.keys(value).forEach((key) => {
        if (shouldStripKey(key)) {
            delete value[key];
            return;
        }
        value[key] = sanitizePayload(value[key]);
    });

    return value;
};

const requestSanitizer = (req, _res, next) => {
    req.body = sanitizePayload(req.body || {});
    req.query = sanitizePayload(req.query || {});
    req.params = sanitizePayload(req.params || {});
    next();
};

module.exports = {
    requestSanitizer,
    sanitizePayload,
};
