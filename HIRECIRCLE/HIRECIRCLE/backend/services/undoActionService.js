'use strict';
/**
 * undoActionService.js
 * Feature #54 — Swipe Back "Undo Last Action"
 *
 * Provides a time-windowed (30-second) undo for key reversible actions:
 *  - Job apply (withdraw application if within window)
 *  - Save job (unsave if within window)
 *  - Follow company (unfollow if within window)
 *  - Send message (mark as retracted within window)
 *
 * Uses an in-memory store per user (suitable for single-instance).
 * For multi-instance: replace with Redis-backed store.
 *
 * Non-disruptive: wrapper pattern — no existing logic modified.
 */

const UNDO_WINDOW_MS = 30 * 1000; // 30 seconds
const MAX_UNDO_STACK_SIZE = 5;

// In-process undo stacks keyed by userId
// Format: Map<userId, Array<{actionId, actionType, payload, createdAt}>>
const undoStacks = new Map();

/**
 * Push a reversible action onto the user's undo stack.
 */
function pushUndoAction(userId, { actionType, payload }) {
    const uid = String(userId);
    if (!undoStacks.has(uid)) undoStacks.set(uid, []);
    const stack = undoStacks.get(uid);

    const entry = {
        actionId: `${uid}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        actionType,
        payload,
        createdAt: Date.now(),
    };

    stack.unshift(entry);
    // Trim to max size
    if (stack.length > MAX_UNDO_STACK_SIZE) stack.length = MAX_UNDO_STACK_SIZE;

    return { actionId: entry.actionId, undoWindowMs: UNDO_WINDOW_MS };
}

/**
 * Peek at the last undoable action for a user.
 */
function peekLastAction(userId) {
    const uid = String(userId);
    const stack = undoStacks.get(uid) || [];
    const recent = stack[0];
    if (!recent) return null;
    const elapsed = Date.now() - recent.createdAt;
    if (elapsed > UNDO_WINDOW_MS) return null; // expired
    return { ...recent, remainingMs: UNDO_WINDOW_MS - elapsed };
}

/**
 * Pop (consume) a specific action for undo execution.
 * Returns the action if within window, null if expired or not found.
 */
function consumeUndoAction(userId, actionId) {
    const uid = String(userId);
    const stack = undoStacks.get(uid) || [];
    const idx = stack.findIndex((e) => e.actionId === actionId);
    if (idx === -1) return null;

    const action = stack[idx];
    const elapsed = Date.now() - action.createdAt;
    if (elapsed > UNDO_WINDOW_MS) {
        stack.splice(idx, 1); // expired — remove but don't execute
        return null;
    }

    stack.splice(idx, 1);
    return action;
}

/**
 * Clear all undo actions for a user (e.g. on logout).
 */
function clearUndoStack(userId) {
    undoStacks.delete(String(userId));
}

const REVERSIBLE_ACTIONS = {
    JOB_APPLY: 'job_apply',
    SAVE_JOB: 'save_job',
    FOLLOW_COMPANY: 'follow_company',
    SEND_MESSAGE: 'send_message',
    REJECT_CANDIDATE: 'reject_candidate',
};

module.exports = {
    pushUndoAction,
    peekLastAction,
    consumeUndoAction,
    clearUndoStack,
    REVERSIBLE_ACTIONS,
    UNDO_WINDOW_MS,
};
