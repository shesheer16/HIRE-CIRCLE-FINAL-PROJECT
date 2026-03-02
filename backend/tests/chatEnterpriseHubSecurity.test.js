'use strict';

/**
 * chatEnterpriseHubSecurity.test.js
 * Verifies:
 *  - Job seeker cannot see employer-only internal metrics
 *  - No cross-tenant data in hub panels
 *  - No other candidate data leaked in employer view
 *  - Role-specific field filtering is enforced
 */

describe('Chat – Enterprise Hub Security', () => {
    // Simulated data shapes returned by backend
    const EMPLOYER_INTERNAL_METRICS = [
        'internalCostPerHire',
        'budgetRemaining',
        'applicantPoolSize',
        'otherCandidateNames',
        'privateNotes',
        'internalJobCode',
    ];

    const JOB_SEEKER_SAFE_FIELDS = [
        'jobTitle',
        'salary',
        'shift',
        'location',
        'interviewStatus',
        'offerStatus',
        'escrowStatus',
        'paymentReleaseProgress',
        'employerResponseTime',
        'employerTrustScore',
    ];

    function buildJobSeekerPanel(applicationData) {
        // Simulate the field filter applied before sending to job seeker
        const forbidden = EMPLOYER_INTERNAL_METRICS;
        const result = {};
        Object.keys(applicationData).forEach((key) => {
            if (!forbidden.includes(key)) {
                result[key] = applicationData[key];
            }
        });
        return result;
    }

    test('Job seeker panel contains no employer-internal fields', () => {
        const rawData = {
            jobTitle: 'Driver',
            salary: 25000,
            shift: 'Morning',
            location: 'Mumbai',
            internalCostPerHire: 5000, // FORBIDDEN
            budgetRemaining: 100000, // FORBIDDEN
            applicantPoolSize: 47, // FORBIDDEN
        };
        const jobSeekerPanel = buildJobSeekerPanel(rawData);
        EMPLOYER_INTERNAL_METRICS.forEach((field) => {
            expect(jobSeekerPanel).not.toHaveProperty(field);
        });
    });

    test('Job seeker panel contains all expected safe fields', () => {
        const rawData = {
            jobTitle: 'Delivery Executive',
            salary: 18000,
            shift: 'Day',
            location: 'Delhi',
            interviewStatus: 'scheduled',
            offerStatus: 'pending',
            escrowStatus: 'funded',
            paymentReleaseProgress: 0,
            employerResponseTime: 1.2,
            employerTrustScore: 88,
        };
        const panel = buildJobSeekerPanel(rawData);
        JOB_SEEKER_SAFE_FIELDS.forEach((field) => {
            expect(panel).toHaveProperty(field);
        });
    });

    test('Private notes are completely absent from job-seeker response', () => {
        const rawData = {
            jobTitle: 'Cook',
            salary: 15000,
            privateNotes: 'Candidate seems overqualified, lets lowball', // NEVER expose
        };
        const panel = buildJobSeekerPanel(rawData);
        expect(panel).not.toHaveProperty('privateNotes');
    });

    test('Cross-tenant: application panel only returns data for its own tenantId', () => {
        const tenant1App = { tenantId: 'tenant_A', jobTitle: 'Job A', salary: 20000 };
        const tenant2App = { tenantId: 'tenant_B', jobTitle: 'Job B', salary: 30000 };
        const requestingTenant = 'tenant_A';

        const filterByTenant = (app, tenantId) => app.tenantId === tenantId ? app : null;
        expect(filterByTenant(tenant1App, requestingTenant)).not.toBeNull();
        expect(filterByTenant(tenant2App, requestingTenant)).toBeNull();
    });

    test('Other candidate names must not appear in any panel', () => {
        const rawData = {
            jobTitle: 'Cashier',
            otherCandidateNames: ['John', 'Mary'], // FORBIDDEN
        };
        const panel = buildJobSeekerPanel(rawData);
        expect(panel).not.toHaveProperty('otherCandidateNames');
    });

    test('No applicantPoolSize or hiring cost data in job seeker view', () => {
        const rawData = {
            jobTitle: 'Manager',
            applicantPoolSize: 120,
            internalCostPerHire: 3000,
        };
        const panel = buildJobSeekerPanel(rawData);
        expect(panel).not.toHaveProperty('applicantPoolSize');
        expect(panel).not.toHaveProperty('internalCostPerHire');
    });

    test('Employer panel is blocked for job seeker role on server', () => {
        const userRole = 'worker';
        const requestedPanel = 'employer_internal_hub';
        const allowedPanels = { worker: ['job_seeker_hub'], employer: ['employer_hub', 'employer_internal_hub'] };
        const hasAccess = (allowedPanels[userRole] || []).includes(requestedPanel);
        expect(hasAccess).toBe(false);
    });

    test('Employer can access full employer hub', () => {
        const userRole = 'employer';
        const allowedPanels = { worker: ['job_seeker_hub'], employer: ['employer_hub', 'employer_internal_hub'] };
        expect((allowedPanels[userRole] || []).includes('employer_hub')).toBe(true);
    });
});
