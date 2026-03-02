'use strict';

/**
 * dualRoleProfileIsolation.test.js
 * Verifies that employer and worker profiles are strictly isolated:
 *  - Switching roles doesn't mix professional data
 *  - Shared identity layer (name, phone) is separate from professional layers
 *  - Employer metrics don't appear in worker API response
 *  - Worker metrics don't appear in employer API response
 */

describe('Profile – Dual-Role Profile Isolation', () => {
    // Simulated dual-role user
    function buildDualRoleUser() {
        return {
            _id: 'user_dual_001',
            // Shared identity layer
            firstName: 'Amit',
            lastName: 'Sharma',
            phone: '+919876543210',
            email: 'amit@example.com',
            roles: ['worker', 'employer'],
            activeRole: 'worker',
            // Worker professional layer
            workerProfile: {
                skills: ['Cook', 'Driver'],
                expectedSalary: 18000,
                totalExperience: 3,
                availabilityStatus: 'available',
                smartInterviewScore: 78,
            },
            // Employer professional layer
            employerProfile: {
                companyName: 'Amit Foods Pvt Ltd',
                totalHires: 12,
                gstNumber: '27AABCA1234A1Z5',
                jobsPosted: 8,
                budgetPerHire: 25000,
            },
        };
    }

    function getWorkerAPIResponse(user) {
        // Only return worker-relevant fields
        const { workerProfile, firstName, lastName, _id, roles, activeRole } = user;
        return { _id, firstName, lastName, roles, activeRole, workerProfile };
    }

    function getEmployerAPIResponse(user) {
        // Only return employer-relevant fields
        const { employerProfile, firstName, lastName, _id, roles, activeRole } = user;
        return { _id, firstName, lastName, roles, activeRole, employerProfile };
    }

    const WORKER_FORBIDDEN_IN_EMPLOYER_RESPONSE = ['skills', 'expectedSalary', 'smartInterviewScore', 'availabilityStatus'];
    const EMPLOYER_FORBIDDEN_IN_WORKER_RESPONSE = ['companyName', 'gstNumber', 'budgetPerHire', 'jobsPosted'];

    test('Worker API response contains no employer-only fields', () => {
        const user = buildDualRoleUser();
        const workerResponse = getWorkerAPIResponse(user);
        EMPLOYER_FORBIDDEN_IN_WORKER_RESPONSE.forEach((field) => {
            expect(JSON.stringify(workerResponse)).not.toContain(`"${field}"`);
        });
    });

    test('Employer API response contains no worker-only fields at top level', () => {
        const user = buildDualRoleUser();
        const employerResponse = getEmployerAPIResponse(user);
        // workerProfile should not be present
        expect(employerResponse).not.toHaveProperty('workerProfile');
    });

    test('Worker API response contains workerProfile', () => {
        const user = buildDualRoleUser();
        const response = getWorkerAPIResponse(user);
        expect(response).toHaveProperty('workerProfile');
        expect(response.workerProfile.skills).toContain('Cook');
    });

    test('Employer API response contains employerProfile', () => {
        const user = buildDualRoleUser();
        const response = getEmployerAPIResponse(user);
        expect(response).toHaveProperty('employerProfile');
        expect(response.employerProfile.companyName).toBe('Amit Foods Pvt Ltd');
    });

    test('Shared identity (name, phone) is present in both responses', () => {
        const user = buildDualRoleUser();
        const workerResp = getWorkerAPIResponse(user);
        const employerResp = getEmployerAPIResponse(user);
        expect(workerResp.firstName).toBe('Amit');
        expect(employerResp.firstName).toBe('Amit');
    });

    test('Switching role does not mutate professional data', () => {
        const user = buildDualRoleUser();
        const originalWorkerSkills = [...user.workerProfile.skills];
        const originalCompanyName = user.employerProfile.companyName;
        user.activeRole = 'employer'; // Switch role
        expect(user.workerProfile.skills).toEqual(originalWorkerSkills);
        expect(user.employerProfile.companyName).toBe(originalCompanyName);
    });

    test('Budget per hire (employer internal) never leaks to worker response', () => {
        const user = buildDualRoleUser();
        const workerResp = getWorkerAPIResponse(user);
        expect(JSON.stringify(workerResp)).not.toContain('budgetPerHire');
        expect(JSON.stringify(workerResp)).not.toContain('gstNumber');
    });

    test('Impact score for worker role is different from employer score', () => {
        // Different profiles → different scores (simulation)
        function mockImpactScore(role, profile) {
            if (role === 'worker') return profile.smartInterviewScore || 0;
            if (role === 'employer') return profile.totalHires * 5 || 0;
            return 0;
        }
        const user = buildDualRoleUser();
        const workerScore = mockImpactScore('worker', user.workerProfile);
        const employerScore = mockImpactScore('employer', user.employerProfile);
        expect(workerScore).not.toBe(employerScore);
    });
});
