'use strict';
/**
 * savedJobsService.js
 * Feature #7 — Saved Job Collections API Service
 */
const SavedJobCollection = require('../models/SavedJobCollection');

const MAX_COLLECTIONS_PER_USER = 20;
const MAX_JOBS_PER_COLLECTION = 500;

async function getOrCreateDefaultCollection(userId) {
    let def = await SavedJobCollection.findOne({ userId, isDefault: true }).lean();
    if (!def) {
        def = await SavedJobCollection.create({
            userId,
            name: 'Saved Jobs',
            isDefault: true,
            emoji: '💾',
        });
    }
    return def;
}

async function listCollections(userId) {
    return SavedJobCollection.find({ userId })
        .sort({ isDefault: -1, updatedAt: -1 })
        .select('name description emoji jobCount isDefault updatedAt')
        .lean();
}

async function createCollection(userId, { name, description = '', emoji = '📌' }) {
    const count = await SavedJobCollection.countDocuments({ userId });
    if (count >= MAX_COLLECTIONS_PER_USER) {
        throw Object.assign(new Error(`Maximum ${MAX_COLLECTIONS_PER_USER} collections allowed per user`), { code: 429 });
    }
    if (!name || !name.trim()) throw Object.assign(new Error('Collection name required'), { code: 400 });
    return SavedJobCollection.create({ userId, name: name.trim(), description, emoji });
}

async function saveJobToCollection(userId, collectionId, jobId, note = '') {
    const collection = await SavedJobCollection.findOne({ _id: collectionId, userId });
    if (!collection) throw Object.assign(new Error('Collection not found'), { code: 404 });
    if (collection.jobs.length >= MAX_JOBS_PER_COLLECTION) {
        throw Object.assign(new Error(`Collection is full (max ${MAX_JOBS_PER_COLLECTION} jobs)`), { code: 429 });
    }
    const exists = collection.jobs.some((j) => String(j.jobId) === String(jobId));
    if (exists) return { alreadySaved: true };
    collection.jobs.push({ jobId, note, savedAt: new Date() });
    await collection.save();
    return { saved: true, jobCount: collection.jobs.length };
}

async function removeJobFromCollection(userId, collectionId, jobId) {
    const collection = await SavedJobCollection.findOne({ _id: collectionId, userId });
    if (!collection) throw Object.assign(new Error('Collection not found'), { code: 404 });
    collection.jobs = collection.jobs.filter((j) => String(j.jobId) !== String(jobId));
    await collection.save();
    return { removed: true };
}

async function deleteCollection(userId, collectionId) {
    const collection = await SavedJobCollection.findOne({ _id: collectionId, userId });
    if (!collection) throw Object.assign(new Error('Collection not found'), { code: 404 });
    if (collection.isDefault) throw Object.assign(new Error('Cannot delete default collection'), { code: 403 });
    await collection.deleteOne();
    return { deleted: true };
}

module.exports = {
    listCollections,
    createCollection,
    getOrCreateDefaultCollection,
    saveJobToCollection,
    removeJobFromCollection,
    deleteCollection,
};
