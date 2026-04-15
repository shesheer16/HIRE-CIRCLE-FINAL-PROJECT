/**
 * connectUtils.js
 * Shared constants, pure helpers, and utility functions for the Connect tab.
 * Extracted from useConnectData.js — no React imports, no side effects.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const FEED_PAGE_SIZE = 20;
export const CONNECT_READ_TIMEOUT_MS = 4000;
export const CONNECT_SAVED_POST_IDS_KEY_PREFIX = '@connect_saved_post_ids_';
export const CONNECT_PENDING_POST_REPORTS_KEY = '@connect_pending_post_reports';
export const CONNECT_TABS = ['Feed', 'Pulse', 'Academy', 'Circles', 'Bounties'];
export const FEED_VISIBILITY_OPTIONS = ['community', 'public', 'connections', 'private'];

// ─── Demo / Test Record Filtering ─────────────────────────────────────────────

const BLOCKED_DEMO_IDENTITIES = new Set([
    'qa user',
    'lokesh user',
    'demo user',
    'test user',
    'sample user',
    'dummy user',
    'mock user',
]);
const BLOCKED_DEMO_PATTERN = /\b(qa user|lokesh user|demo user|test user|sample user|dummy user|mock user)\b/i;

export const normalizeMatchText = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9@.\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const hasBlockedDemoIdentity = (value) => {
    const normalized = normalizeMatchText(value);
    if (!normalized) return false;
    if (BLOCKED_DEMO_IDENTITIES.has(normalized)) return true;
    return BLOCKED_DEMO_PATTERN.test(normalized);
};

export const isDemoRecord = (record) => {
    if (!record || typeof record !== 'object') return false;
    if (Boolean(record?.isDemo || record?.isMock || record?.mock || record?.seed || record?.sampleData || record?.testData)) {
        return true;
    }
    const candidates = [
        record?.name,
        record?.title,
        record?.author,
        record?.authorName,
        record?.content,
        record?.description,
        record?.company,
        record?.companyName,
        record?.creatorName,
        record?.email,
        record?.phone,
        record?.user?.name,
        record?.user?.email,
        record?.authorId?.name,
        record?.authorId?.email,
    ];
    return candidates.some(hasBlockedDemoIdentity);
};

// ─── Time Helpers ─────────────────────────────────────────────────────────────

export const timeAgo = (dateString) => {
    if (!dateString) return 'Just now';
    const date = new Date(dateString);
    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
};

// ─── Error Handling ───────────────────────────────────────────────────────────

export const getApiErrorMessage = (error, fallback = 'Something went wrong. Please try again.') => {
    const message = String(error?.response?.data?.message || error?.message || '').trim();
    return message || fallback;
};

// ─── Storage ──────────────────────────────────────────────────────────────────

export const getSavedPostsStorageKey = (userId = 'guest') => (
    `${CONNECT_SAVED_POST_IDS_KEY_PREFIX}${String(userId || 'guest').trim() || 'guest'}`
);

export const parseSavedPostIds = (rawValue) => {
    try {
        const parsed = JSON.parse(String(rawValue || '[]'));
        if (!Array.isArray(parsed)) return new Set();
        return new Set(
            parsed
                .map((id) => String(id || '').trim())
                .filter(Boolean)
        );
    } catch (_error) {
        return new Set();
    }
};

// ─── Comment Mapping ──────────────────────────────────────────────────────────

export const mapCommentEntry = (comment, index = 0, postId = 'post') => {
    if (typeof comment === 'string') {
        const text = String(comment).trim();
        if (!text) return null;
        return {
            id: `comment-${String(postId)}-${index}`,
            text,
            author: 'Member',
            time: '',
        };
    }
    if (!comment || typeof comment !== 'object') return null;
    const text = String(comment?.text || '').trim();
    if (!text) return null;
    const author = String(
        comment?.user?.name
        || comment?.author?.name
        || comment?.authorName
        || comment?.author
        || 'Member'
    ).trim() || 'Member';
    if (hasBlockedDemoIdentity(author)) return null;
    const createdAt = String(comment?.createdAt || comment?.time || '').trim();
    return {
        id: String(comment?._id || comment?.id || `comment-${String(postId)}-${index}`),
        text,
        author,
        time: createdAt ? timeAgo(createdAt) : '',
    };
};

export const mapCommentEntries = (comments = [], postId = 'post') => (
    Array.isArray(comments)
        ? comments.map((comment, index) => mapCommentEntry(comment, index, postId)).filter(Boolean)
        : []
);

export const findCommentsArrayInPayload = (payload = {}) => {
    const candidates = [
        payload?.comments,
        payload?.data?.comments,
        payload?.post?.comments,
        payload?.data?.post?.comments,
        payload?.item?.comments,
        payload?.data?.item?.comments,
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate;
    }
    return null;
};

export const extractCommentEntriesFromPayload = (payload = {}, postId = 'post') => {
    const commentsArray = findCommentsArrayInPayload(payload);
    if (!Array.isArray(commentsArray)) return null;
    return mapCommentEntries(commentsArray, postId);
};

// ─── Media Helpers ────────────────────────────────────────────────────────────

export const inferMediaMimeType = (asset = {}) => {
    if (asset?.mimeType) return String(asset.mimeType);
    const mediaType = String(asset?.type || '').toLowerCase();
    if (mediaType === 'video') return 'video/mp4';
    if (mediaType === 'audio') return 'audio/m4a';
    if (mediaType === 'image') return 'image/jpeg';
    return 'application/octet-stream';
};

export const normalizePickedAssets = (assets = []) => (
    Array.isArray(assets)
        ? assets
            .map((asset, index) => {
                const uri = String(asset?.uri || '').trim();
                if (!uri) return null;
                return {
                    id: String(asset?.assetId || `${Date.now()}-${index}`),
                    uri,
                    type: String(asset?.type || '').toLowerCase(),
                    width: Number(asset?.width || 0),
                    height: Number(asset?.height || 0),
                    durationMs: Number(asset?.duration || 0),
                    fileSize: Number(asset?.fileSize || 0),
                    mimeType: inferMediaMimeType(asset),
                };
            })
            .filter(Boolean)
        : []
);

// ─── Feed Payload Helpers ─────────────────────────────────────────────────────

export const extractFeedRowsFromPayload = (payload = {}) => {
    const candidates = [
        payload?.posts,
        payload?.data?.posts,
        payload?.data?.data?.posts,
        payload?.items,
        payload?.data?.items,
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate;
    }
    return [];
};

export const extractFeedHasMoreFromPayload = (payload = {}, rowsLength = 0) => {
    const candidates = [
        payload?.hasMore,
        payload?.data?.hasMore,
        payload?.data?.data?.hasMore,
        payload?.pagination?.hasMore,
        payload?.data?.pagination?.hasMore,
        payload?.meta?.hasMore,
        payload?.data?.meta?.hasMore,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'boolean') return candidate;
    }
    if (rowsLength <= 0) return false;
    return rowsLength >= FEED_PAGE_SIZE;
};
