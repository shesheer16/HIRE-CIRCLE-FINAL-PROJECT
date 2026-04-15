const mongoose = require('mongoose');

const DEFAULT_WEB_URL = 'https://hireapp.com';

const getWebBaseUrl = () => {
    const fromEnv = String(process.env.WEB_URL || process.env.FRONTEND_URL || DEFAULT_WEB_URL).trim();
    return fromEnv.replace(/\/$/, '');
};

const slugify = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'item';

const buildEntityPath = ({ basePath, title, id }) => {
    const objectId = String(id || '').trim();
    const safeSlug = slugify(title || 'item');
    return `${basePath}/${safeSlug}-${objectId}`;
};

const buildReferralInviteLink = (referralCode) => {
    const code = encodeURIComponent(String(referralCode || '').trim());
    return `${getWebBaseUrl()}/signup?ref=${code}`;
};

const buildProfileShareLink = ({ userId, displayName }) => `${getWebBaseUrl()}${buildEntityPath({
    basePath: '/profiles',
    title: displayName || 'profile',
    id: userId,
})}`;

const buildJobShareLink = ({ jobId, title }) => `${getWebBaseUrl()}${buildEntityPath({
    basePath: '/jobs',
    title: title || 'job',
    id: jobId,
})}`;

const buildCommunityShareLink = ({ circleId, name }) => `${getWebBaseUrl()}${buildEntityPath({
    basePath: '/community',
    title: name || 'community',
    id: circleId,
})}`;

const buildBountyShareLink = ({ bountyId, title }) => `${getWebBaseUrl()}${buildEntityPath({
    basePath: '/bounties',
    title: title || 'bounty',
    id: bountyId,
})}`;

const extractObjectIdFromSeoSlug = (value) => {
    const raw = String(value || '').trim();
    if (mongoose.Types.ObjectId.isValid(raw)) return raw;

    const parts = raw.split('-');
    const tail = parts[parts.length - 1] || '';
    if (mongoose.Types.ObjectId.isValid(tail)) return tail;

    return null;
};

const buildSeoMetadata = ({ title, description, url, type = 'website', image = null }) => ({
    title: String(title || '').trim(),
    description: String(description || '').trim(),
    canonicalUrl: String(url || '').trim(),
    openGraph: {
        type,
        title: String(title || '').trim(),
        description: String(description || '').trim(),
        url: String(url || '').trim(),
        image: image || `${getWebBaseUrl()}/assets/seo-default.png`,
    },
    twitter: {
        card: 'summary_large_image',
        title: String(title || '').trim(),
        description: String(description || '').trim(),
        image: image || `${getWebBaseUrl()}/assets/seo-default.png`,
    },
});

module.exports = {
    getWebBaseUrl,
    slugify,
    buildReferralInviteLink,
    buildProfileShareLink,
    buildJobShareLink,
    buildCommunityShareLink,
    buildBountyShareLink,
    extractObjectIdFromSeoSlug,
    buildSeoMetadata,
};
