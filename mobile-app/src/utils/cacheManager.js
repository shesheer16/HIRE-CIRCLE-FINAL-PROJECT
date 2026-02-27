import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from './logger';

const TTL = {
    // 24 Hours in milliseconds
    SHORT: 24 * 60 * 60 * 1000,
    // 7 Days
    LONG: 7 * 24 * 60 * 60 * 1000
};

/**
 * Saves an array payload to AsyncStorage with a maximum retained limit.
 */
export const saveLimitedCache = async (key, data, maxItems = 100) => {
    try {
        const existingString = await AsyncStorage.getItem(key);
        const existing = existingString ? JSON.parse(existingString) : [];

        let merged;
        if (Array.isArray(data)) {
            merged = [...existing, ...data];
        } else {
            merged = [...existing, data];
        }

        // Deduplicate over _id if exists, otherwise keep raw elements
        const unique = merged.filter((item, index, self) =>
            index === self.findIndex((t) => (
                t._id ? t._id === item._id : t === item
            ))
        );

        const limited = unique.slice(-maxItems); // Keep only latest maxItems elements
        await AsyncStorage.setItem(key, JSON.stringify(limited));
    } catch (e) {
        logger.error(`Cache Save Error (${key}):`, e);
    }
};

/**
 * Saves a single object payload wrapped in a Timestamp for TTL invalidation.
 */
export const saveWithTTL = async (key, data) => {
    try {
        const payload = {
            timestamp: Date.now(),
            data
        };
        await AsyncStorage.setItem(key, JSON.stringify(payload));
    } catch (e) {
        logger.error(`TTL Cache Save Error (${key}):`, e);
    }
};

/**
 * Retrieves a TTL cache object. Returns null if expired.
 */
export const getWithTTL = async (key, maxAgeMs = TTL.SHORT) => {
    try {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (!parsed.timestamp || Date.now() - parsed.timestamp > maxAgeMs) {
            await AsyncStorage.removeItem(key);
            logger.log(`Cache Key ${key} expired or invalid. Evicting.`);
            return null;
        }

        return parsed.data;
    } catch (e) {
        logger.error(`TTL Cache Read Error (${key}):`, e);
        return null;
    }
};

/**
 * Purge user-specific data bounds upon explicit Logouts.
 */
export const wipeSensitiveCache = async () => {
    try {
        if (!AsyncStorage || typeof AsyncStorage.getAllKeys !== 'function') {
            logger.warn('AsyncStorage not fully available, skipping cache wipe');
            return;
        }

        const allKeys = await AsyncStorage.getAllKeys();

        // Remove chat histories, explanation models, and applicant lists
        const keysToRemove = allKeys.filter(key =>
            key.includes('@chat_history_') ||
            key.includes('@explain_') ||
            key.includes('@cached_candidates_') ||
            key.includes('userInfo')
        );

        if (keysToRemove.length > 0) {
            await AsyncStorage.multiRemove(keysToRemove);
            logger.log(`🧹 Sensitive cache purged. (${keysToRemove.length} entries removed)`);
        } else {
            logger.log(`🧹 Cache wipe skipped. (No entries to remove)`);
        }
    } catch (e) {
        logger.error('Explicit Logout Cache Wipe failed:', e);
    }
}
