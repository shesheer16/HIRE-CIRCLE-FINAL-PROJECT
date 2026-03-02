'use strict';

/**
 * skillNormalizationEngine.test.js
 * Tests skill normalization, synonym mapping, spam prevention, injection prevention.
 */

// Inline normalization engine for testing (mirrors what service would do)
const SKILL_SYNONYMS = {
    'driver': 'Delivery Driver',
    'delivery': 'Delivery Driver',
    'delivery driver': 'Delivery Driver',
    'cook': 'Cook',
    'chef': 'Cook',
    'cleaner': 'Cleaning Staff',
    'cleaning': 'Cleaning Staff',
    'housekeeper': 'Cleaning Staff',
    'security guard': 'Security Guard',
    'watchman': 'Security Guard',
};

const MAX_SKILLS = 20;

function normalizeSkill(raw) {
    const lower = String(raw || '').trim().toLowerCase();
    return SKILL_SYNONYMS[lower] || (raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1));
}

function sanitizeSkill(raw) {
    // Strip script injection
    return String(raw || '').replace(/<[^>]*>/g, '').replace(/[<>'"]/g, '').trim();
}

function normalizeSkillList(skills) {
    if (!Array.isArray(skills)) return [];
    if (skills.length > MAX_SKILLS) {
        throw Object.assign(new Error(`Maximum ${MAX_SKILLS} skills allowed`), { code: 400 });
    }
    const seen = new Set();
    return skills
        .map((s) => sanitizeSkill(s))
        .filter((s) => s.length > 0 && s.length <= 100)
        .map(normalizeSkill)
        .filter((s) => {
            if (seen.has(s.toLowerCase())) return false;
            seen.add(s.toLowerCase());
            return true;
        });
}

describe('Profile – Skill Normalization Engine', () => {
    test('Synonyms are correctly mapped', () => {
        expect(normalizeSkill('driver')).toBe('Delivery Driver');
        expect(normalizeSkill('cook')).toBe('Cook');
        expect(normalizeSkill('chef')).toBe('Cook');
        expect(normalizeSkill('watchman')).toBe('Security Guard');
        expect(normalizeSkill('housekeeper')).toBe('Cleaning Staff');
    });

    test('Unknown skill is capitalized but not rejected', () => {
        expect(normalizeSkill('plumber')).toBe('Plumber');
    });

    test('Duplicate skills are deduplicated', () => {
        const result = normalizeSkillList(['cook', 'chef', 'Cook']);
        const countOfCook = result.filter((s) => s === 'Cook').length;
        expect(countOfCook).toBe(1);
    });

    test('More than 20 skills throws an error', () => {
        const tooMany = Array.from({ length: 21 }, (_, i) => `Skill ${i}`);
        expect(() => normalizeSkillList(tooMany)).toThrow();
    });

    test('Exactly 20 skills is allowed', () => {
        const skills = Array.from({ length: 20 }, (_, i) => `Skill ${i}`);
        expect(() => normalizeSkillList(skills)).not.toThrow();
    });

    test('Script injection tags are stripped from skill input', () => {
        const malicious = '<script>xss</script>Driver';
        const safe = sanitizeSkill(malicious);
        expect(safe).not.toContain('<script>');
        expect(safe).not.toContain('</script>');
        expect(safe).toContain('Driver');
    });

    test('HTML tags are removed from skills', () => {
        const withHtml = '<b>strong</b>';
        const safe = sanitizeSkill(withHtml);
        expect(safe).not.toContain('<b>');
        expect(safe).not.toContain('</b>');
    });

    test('Empty skills are filtered out', () => {
        const result = normalizeSkillList(['', '   ', 'Cook']);
        expect(result).not.toContain('');
        expect(result).toContain('Cook');
    });

    test('Skill over 100 chars is filtered out', () => {
        const tooLong = 'A'.repeat(101);
        const result = normalizeSkillList([tooLong, 'Cook']);
        expect(result).not.toContain(tooLong);
        expect(result).toContain('Cook');
    });

    test('Non-array input returns empty array', () => {
        expect(normalizeSkillList(null)).toEqual([]);
        expect(normalizeSkillList('cook')).toEqual([]);
    });
});
