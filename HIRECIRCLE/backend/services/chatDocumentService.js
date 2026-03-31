/**
 * chatDocumentService — Secure document center for hiring chats (local storage).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALLOWED_DOCUMENT_TYPES = ['resume', 'offer_letter', 'contract', 'id_verification', 'work_agreement'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const LOCK_STATUSES = ['offer_accepted', 'hired', 'work_started', 'work_completed', 'payment_released'];
const STORAGE_ROOT = path.resolve(__dirname, '..', 'uploads', 'chat-documents');

const ensureStorageRoot = () => {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
};

const sanitizePathPart = (value = '') => String(value || '')
    .replace(/\\/g, '/')
    .replace(/\.{2,}/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);

const sanitizeDocumentKey = (value = '') => {
    const normalized = String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .map((part) => part.trim())
        .filter((part) => part && part !== '.' && part !== '..')
        .join('/');
    return normalized;
};

const toAbsolutePath = (documentKey) => {
    const normalized = sanitizeDocumentKey(documentKey);
    if (!normalized || !normalized.startsWith('chat-documents/')) return null;

    const absolutePath = path.resolve(path.join(__dirname, '..', 'uploads'), normalized);
    const uploadsRoot = path.resolve(path.join(__dirname, '..', 'uploads'));
    if (!absolutePath.startsWith(uploadsRoot)) return null;
    return absolutePath;
};

const toPublicUrl = (documentKey) => {
    const apiPublicUrl = String(process.env.API_PUBLIC_URL || '').trim().replace(/\/$/, '');
    const relative = `/uploads/${String(documentKey || '').replace(/^\/+/, '')}`;
    if (!apiPublicUrl) return relative;
    return `${apiPublicUrl}${relative}`;
};

const listFilesRecursively = (directoryPath) => {
    if (!fs.existsSync(directoryPath)) return [];

    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const absolute = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFilesRecursively(absolute));
            continue;
        }
        if (entry.isFile()) {
            files.push(absolute);
        }
    }

    return files;
};

async function validateAccess(applicationId, userId) {
    const Application = require('../models/Application');
    const app = await Application.findById(applicationId).select('employer worker status').lean();
    if (!app) throw Object.assign(new Error('Application not found'), { code: 404 });

    const empId = String(app.employer?._id || app.employer || '');
    const workerId = String(app.worker?._id || app.worker || '');
    const uid = String(userId);
    if (uid !== empId && uid !== workerId) {
        throw Object.assign(new Error('Access denied: not a participant in this application'), { code: 403 });
    }

    return { application: app, isEmployer: uid === empId };
}

async function uploadDocument(applicationId, uploaderId, file, documentType) {
    if (!ALLOWED_DOCUMENT_TYPES.includes(documentType)) {
        throw Object.assign(new Error(`Invalid document type. Allowed: ${ALLOWED_DOCUMENT_TYPES.join(', ')}`), { code: 400 });
    }
    if (!file || !file.buffer) {
        throw Object.assign(new Error('No file buffer provided'), { code: 400 });
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
        throw Object.assign(new Error('File exceeds 10MB size limit'), { code: 413 });
    }

    const { isEmployer } = await validateAccess(applicationId, uploaderId);

    if (['offer_letter', 'contract'].includes(documentType) && !isEmployer) {
        throw Object.assign(new Error('Only employer can upload offer letters and contracts'), { code: 403 });
    }

    ensureStorageRoot();

    const safeOriginalName = sanitizePathPart(file.originalname || 'document') || 'document';
    const fileId = crypto.randomUUID();
    const appId = sanitizePathPart(String(applicationId || ''));
    const typePart = sanitizePathPart(String(documentType || 'other'));
    const documentKey = `chat-documents/${appId}/${typePart}/${fileId}/${safeOriginalName}`;
    const absolutePath = toAbsolutePath(documentKey);

    if (!absolutePath) {
        throw Object.assign(new Error('Failed to resolve local storage path'), { code: 500 });
    }

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, file.buffer);

    const uploadedAt = new Date().toISOString();
    return {
        fileId,
        documentKey,
        s3Key: documentKey,
        documentType,
        originalName: file.originalname,
        size: file.size,
        uploadedBy: uploaderId,
        uploadedAt,
    };
}

async function getSignedDownloadUrl(applicationId, documentKey, requesterId) {
    await validateAccess(applicationId, requesterId);

    const normalized = sanitizeDocumentKey(documentKey);
    const prefix = `chat-documents/${sanitizePathPart(String(applicationId || ''))}/`;
    if (!normalized.startsWith(prefix)) {
        throw Object.assign(new Error('Access denied: document does not belong to this application'), { code: 403 });
    }

    const absolutePath = toAbsolutePath(normalized);
    if (!absolutePath || !fs.existsSync(absolutePath)) {
        throw Object.assign(new Error('Document not found'), { code: 404 });
    }

    return {
        signedUrl: toPublicUrl(normalized),
        expiresInSeconds: 3600,
    };
}

async function deleteDocument(applicationId, documentKey, requesterId) {
    const { application, isEmployer } = await validateAccess(applicationId, requesterId);

    if (LOCK_STATUSES.includes(String(application.status || '').toLowerCase())) {
        throw Object.assign(new Error('Documents cannot be deleted after an offer has been accepted'), { code: 403 });
    }

    if (!isEmployer) {
        throw Object.assign(new Error('Only employer can delete documents'), { code: 403 });
    }

    const normalized = sanitizeDocumentKey(documentKey);
    const prefix = `chat-documents/${sanitizePathPart(String(applicationId || ''))}/`;
    if (!normalized.startsWith(prefix)) {
        throw Object.assign(new Error('Access denied: document does not belong to this application'), { code: 403 });
    }

    const absolutePath = toAbsolutePath(normalized);
    if (absolutePath && fs.existsSync(absolutePath)) {
        await fs.promises.unlink(absolutePath).catch(() => null);
    }

    return { deleted: true, documentKey: normalized, s3Key: normalized };
}

async function listDocuments(applicationId, requesterId) {
    await validateAccess(applicationId, requesterId);

    const appRoot = path.join(STORAGE_ROOT, sanitizePathPart(String(applicationId || '')));
    const files = listFilesRecursively(appRoot);

    const uploadsRoot = path.resolve(path.join(__dirname, '..', 'uploads'));
    return files
        .map((absolutePath) => {
            const relative = path.relative(uploadsRoot, absolutePath).replace(/\\/g, '/');
            const stats = fs.statSync(absolutePath);
            const parts = relative.split('/');
            return {
                documentKey: relative,
                s3Key: relative,
                size: Number(stats.size || 0),
                lastModified: stats.mtime,
                documentType: parts[2] || 'unknown',
                originalName: parts[parts.length - 1] || 'document',
            };
        })
        .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
}

module.exports = {
    uploadDocument,
    getSignedDownloadUrl,
    deleteDocument,
    listDocuments,
    ALLOWED_DOCUMENT_TYPES,
    MAX_FILE_SIZE_BYTES,
    validateAccess,
};
