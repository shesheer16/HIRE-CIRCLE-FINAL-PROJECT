'use strict';
/**
 * uiInteractionService.js
 * Feature #4: Swipe job cards like Tinder
 * Feature #5: Shake to find random job
 * Feature #11: Animated micro-interactions (reactions, emojis)
 * Feature #21: Pull to refresh with hub effect
 * Feature #27: Swipe for quick actions in list (apply/skip)
 * 
 * Non-disruptive logic converting app interactions to backend payloads 
 * and supplying animation config triggers to the frontend.
 */

/**
 * Feature #4 & #27: Interpret a swipe gesture into a standard backend action intent.
 * Left = Skip, Right = Save/Apply.
 */
function interpretSwipeAction(direction, velocity = 1, isList = false) {
    if (direction === 'left') {
        return { action: 'skip', confidence: velocity > 2 ? 'high' : 'normal' };
    }
    if (direction === 'right') {
        // In list view #27, right swipe might directly trigger apply.
        // In card view #4, right swipe is usually save/shortlist.
        return { action: isList ? 'apply' : 'save', confidence: velocity > 2 ? 'high' : 'normal' };
    }
    return { action: 'unknown', confidence: 'none' };
}

/**
 * Feature #5: Handle "Shake" device gesture.
 * Returns a randomized job from the pool to simulate discovery serendipity.
 */
function handleShakeGesture(availableJobs = []) {
    if (!availableJobs.length) return null;
    // Pick a truly random job
    const randomIndex = Math.floor(Math.random() * availableJobs.length);
    const selected = availableJobs[randomIndex];

    return {
        job: selected,
        animation: 'shake_reveal', // Instructs frontend to play specific animation
        timestamp: new Date()
    };
}

/**
 * Feature #11 & #21: Supply UI interaction configs for the frontend.
 * Provides the current active asset URIs or effect states for micro-interactions.
 */
function getMicroInteractionConfig() {
    return {
        pullToRefreshState: 'hub_spinner_active',
        reactions: [
            { id: 'fire', icon: '🔥', weight: 1.5 },
            { id: 'heart', icon: '❤️', weight: 2.0 },
            { id: 'clap', icon: '👏', weight: 1.0 }
        ]
    };
}

module.exports = {
    interpretSwipeAction,
    handleShakeGesture,
    getMicroInteractionConfig
};
