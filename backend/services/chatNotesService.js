/**
 * chatNotesService — Private employer-only notes for a hiring chat.
 *
 * Security guarantees:
 *  - Employer-only write & read access
 *  - Notes are NEVER returned in any job-seeker-facing API
 *  - All mutations are audit-logged on the ChatNote model
 *  - Rate limited: max 20 notes per application per employer
 */
'use strict';

const ChatNote = require('../models/ChatNote');

const MAX_NOTES_PER_APPLICATION = 20;

/**
 * Validate that the user is the employer for this application.
 * Throws 403 if not.
 */
async function assertEmployerAccess(applicationId, userId) {
    const Application = require('../models/Application');
    const app = await Application.findById(applicationId).select('employer').lean();
    if (!app) throw Object.assign(new Error('Application not found'), { code: 404 });
    const empId = String(app.employer?._id || app.employer || '');
    if (String(userId) !== empId) {
        throw Object.assign(new Error('Access denied: private notes are employer-only'), { code: 403 });
    }
    return true;
}

/**
 * Create a new private note for an application.
 */
async function createNote(applicationId, employerId, content) {
    await assertEmployerAccess(applicationId, employerId);

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        throw Object.assign(new Error('Note content cannot be empty'), { code: 400 });
    }
    if (content.trim().length > 5000) {
        throw Object.assign(new Error('Note content exceeds 5000 character limit'), { code: 400 });
    }

    // Rate limit: max 20 non-deleted notes per application per employer
    const existingCount = await ChatNote.countDocuments({
        applicationId,
        employerId,
        isDeleted: false,
    });
    if (existingCount >= MAX_NOTES_PER_APPLICATION) {
        throw Object.assign(new Error(`Maximum ${MAX_NOTES_PER_APPLICATION} notes reached for this application`), { code: 429 });
    }

    const note = new ChatNote({
        applicationId,
        employerId,
        content: content.trim(),
    });
    await note.save();
    return note.toObject();
}

/**
 * List all active notes for an application (employer-only).
 */
async function listNotes(applicationId, employerId) {
    await assertEmployerAccess(applicationId, employerId);
    const notes = await ChatNote.find({
        applicationId,
        employerId,
        isDeleted: false,
    })
        .sort({ createdAt: -1 })
        .select('-auditLog') // Never expose full audit log in list
        .lean();
    return notes;
}

/**
 * Edit a note (employer-only, audit-logged).
 */
async function editNote(noteId, employerId, newContent) {
    const note = await ChatNote.findById(noteId);
    if (!note) throw Object.assign(new Error('Note not found'), { code: 404 });
    if (String(note.employerId) !== String(employerId)) {
        throw Object.assign(new Error('Access denied'), { code: 403 });
    }
    if (note.isDeleted) throw Object.assign(new Error('Cannot edit a deleted note'), { code: 400 });

    if (!newContent || newContent.trim().length === 0) {
        throw Object.assign(new Error('Content cannot be empty'), { code: 400 });
    }

    note._previousContent = note.content;
    note.content = newContent.trim();
    await note.save();
    return note.toObject();
}

/**
 * Soft-delete a note (employer-only, audit-logged).
 */
async function deleteNote(noteId, employerId) {
    const note = await ChatNote.findById(noteId);
    if (!note) throw Object.assign(new Error('Note not found'), { code: 404 });
    if (String(note.employerId) !== String(employerId)) {
        throw Object.assign(new Error('Access denied'), { code: 403 });
    }
    if (note.isDeleted) return { deleted: true, alreadyDeleted: true };

    note.isDeleted = true;
    note.auditLog.push({ action: 'deleted', at: new Date(), byEmployerId: employerId });
    // Bypass pre-save hook for deletion (content not modified)
    await ChatNote.updateOne({ _id: note._id }, { isDeleted: true, $push: { auditLog: { action: 'deleted', at: new Date(), byEmployerId: employerId } } });
    return { deleted: true };
}

module.exports = {
    createNote,
    listNotes,
    editNote,
    deleteNote,
    assertEmployerAccess,
};
