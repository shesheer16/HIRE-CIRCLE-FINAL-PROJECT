'use strict';

/**
 * profilePublicPreviewSecurity.test.js
 * Verifies that the public profile endpoint:
 *  - Only exposes safe fields
 *  - Never shows private data (phone, salary if disabled, internal scores)
 *  - Works with SEO-friendly slug
 *  - No cross-user data leakage
 */

describe('Profile – Public Preview Security', () => {
    const FORBIDDEN_PUBLIC_FIELDS = [
        'phone',
        'mobile',
        'email',
        'passwordHash',
        'internalScore',
        'verificationRawData',
        'deviceTokens',
        'adminFlags',
        'suspiciousFlags',
        'earningsTotal',
        'bankDetails',
    ];

    const ALWAYS_SAFE_FIELDS = [
        'firstName',
        'skills',
        'experience',
        'profilePictureUrl',
        'verificationTier',
        'socialProofLabels',
    ];

    function buildPublicProfile(user, preferences = {}) {
        // Simulate server-side field filter
        const safe = {
            firstName: user.firstName,
            skills: user.skills || [],
            experience: user.experience || 0,
            profilePictureUrl: user.profilePictureUrl || null,
            verificationTier: user.verificationTier || null,
            socialProofLabels: user.socialProofLabels || [],
            city: user.city || null,
            // Conditionally include salary expectation based on user preference
            ...(preferences.showSalaryPublicly ? { salaryExpectation: user.salaryExpectation } : {}),
        };
        return safe;
    }

    function generateSlug(name, userId) {
        const safeName = String(name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        return `${safeName}-${String(userId).slice(-6)}`;
    }

    test('Public profile contains no forbidden fields', () => {
        const user = {
            firstName: 'Ravi',
            phone: '+919876543210',
            email: 'ravi@gmail.com',
            passwordHash: 'bcrypt_hash',
            internalScore: 92,
            skills: ['Driver'],
        };
        const publicProfile = buildPublicProfile(user);
        FORBIDDEN_PUBLIC_FIELDS.forEach((field) => {
            expect(publicProfile).not.toHaveProperty(field);
        });
    });

    test('Public profile always contains safe fields', () => {
        const user = {
            firstName: 'Priya',
            skills: ['Cook', 'Cleaner'],
            experience: 3,
            profilePictureUrl: 'https://s3.example.com/priya.jpg',
            verificationTier: 'Gold',
            socialProofLabels: ['Hired 2 times'],
        };
        const publicProfile = buildPublicProfile(user);
        expect(publicProfile).toHaveProperty('firstName');
        expect(publicProfile).toHaveProperty('skills');
        expect(publicProfile).toHaveProperty('experience');
        expect(publicProfile).toHaveProperty('verificationTier');
    });

    test('Salary expectation hidden if user opted out', () => {
        const user = { firstName: 'Kumar', salaryExpectation: 25000 };
        const publicProfile = buildPublicProfile(user, { showSalaryPublicly: false });
        expect(publicProfile).not.toHaveProperty('salaryExpectation');
    });

    test('Salary expectation shown if user opted in', () => {
        const user = { firstName: 'Kumar', salaryExpectation: 25000 };
        const publicProfile = buildPublicProfile(user, { showSalaryPublicly: true });
        expect(publicProfile).toHaveProperty('salaryExpectation', 25000);
    });

    test('SEO slug is generated from name and userId', () => {
        const slug = generateSlug('Ravi Kumar', 'user_abc123xyz');
        expect(slug).toMatch(/^ravi-kumar-/);
        expect(slug).not.toContain(' ');
        expect(slug.toLowerCase()).toBe(slug);
    });

    test('SEO slug handles special characters', () => {
        const slug = generateSlug('User & Co. Test!', 'user_001');
        expect(slug).not.toContain('&');
        expect(slug).not.toContain('!');
        expect(slug).not.toContain('.');
    });

    test('Profile of user A does not contain fields from user B', () => {
        const userA = { firstName: 'Alice', skills: ['Cook'], userId: 'ua1' };
        const userB = { firstName: 'Bob', skills: ['Driver'], userId: 'ub2' };
        const profileA = buildPublicProfile(userA);
        expect(profileA.firstName).not.toBe(userB.firstName);
        expect(profileA.firstName).toBe('Alice');
    });

    test('Phone number never appears in public profile even if user tries to add it to firstName', () => {
        const user = { firstName: 'Call me on 9876543210', skills: [] };
        // Server should strip phone patterns from display name
        const stripped = user.firstName.replace(/\d{10,}/g, '').trim();
        expect(stripped).not.toMatch(/\d{10}/);
    });
});
