'use strict';
/**
 * savedSearchService.js
 * Feature #17 — Saved Searches + Alert Triggers
 */
const SavedSearch = require('../models/SavedSearch');

const MAX_SAVED_SEARCHES = 15;

async function listSavedSearches(userId) {
    return SavedSearch.find({ userId })
        .sort({ updatedAt: -1 })
        .select('name filters alertEnabled alertFrequency hitCount updatedAt')
        .lean();
}

async function createSavedSearch(userId, { name, filters = {}, alertEnabled = true, alertFrequency = 'daily' }) {
    const count = await SavedSearch.countDocuments({ userId });
    if (count >= MAX_SAVED_SEARCHES) {
        throw Object.assign(new Error(`Maximum ${MAX_SAVED_SEARCHES} saved searches per user`), { code: 429 });
    }
    if (!name?.trim()) throw Object.assign(new Error('Search name required'), { code: 400 });
    return SavedSearch.create({ userId, name: name.trim(), filters, alertEnabled, alertFrequency });
}

async function updateSavedSearch(userId, searchId, updates = {}) {
    const search = await SavedSearch.findOne({ _id: searchId, userId });
    if (!search) throw Object.assign(new Error('Saved search not found'), { code: 404 });
    Object.assign(search, updates);
    await search.save();
    return search.toObject();
}

async function deleteSavedSearch(userId, searchId) {
    const result = await SavedSearch.deleteOne({ _id: searchId, userId });
    if (!result.deletedCount) throw Object.assign(new Error('Saved search not found'), { code: 404 });
    return { deleted: true };
}

async function incrementHitCount(searchId) {
    await SavedSearch.updateOne({ _id: searchId }, { $inc: { hitCount: 1 } });
}

// Called by background job to notify users of new matching jobs
async function getAlertableSearches(frequencyBucket) {
    const cutoff = new Map([
        ['realtime', new Date(Date.now() - 5 * 60 * 1000)],        // 5 min
        ['daily', new Date(Date.now() - 23 * 60 * 60 * 1000)],     // 23h
        ['weekly', new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)], // 6d
    ]).get(frequencyBucket);

    return SavedSearch.find({
        alertEnabled: true,
        alertFrequency: frequencyBucket,
        $or: [{ lastAlertSentAt: null }, { lastAlertSentAt: { $lt: cutoff } }],
    }).lean();
}

module.exports = {
    listSavedSearches,
    createSavedSearch,
    updateSavedSearch,
    deleteSavedSearch,
    incrementHitCount,
    getAlertableSearches,
};
