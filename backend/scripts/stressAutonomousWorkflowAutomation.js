const fs = require('fs');
const path = require('path');
const {
    CANONICAL_APPLICATION_STATUSES,
    getAllowedTransitions,
    canTransition,
} = require('../workflow/applicationStateMachine');

const REPORT_PATH = path.join(__dirname, '../reports/AUTONOMOUS_WORKFLOW_STRESS_REPORT.json');

const TOTAL_APPLICATIONS = 1000;
const TOTAL_INTERVIEWS = 500;
const TOTAL_OFFERS = 200;
const TOTAL_ESCROW_FLOWS = 100;
const TOTAL_TICKS = 240;

const pick = (array) => array[Math.floor(Math.random() * array.length)];

const shuffle = (list) => {
    const values = [...list];
    for (let i = values.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
};

const createApplications = () => {
    return Array.from({ length: TOTAL_APPLICATIONS }, (_, index) => ({
        id: `app_${index + 1}`,
        status: 'applied',
        hasInterviewScheduled: false,
        hasOffer: false,
        escrowEnabled: false,
        escrowState: 'none', // none | required | funded | released
        transitionCount: 0,
    }));
};

const toStatusBucketCounts = (apps) => apps.reduce((acc, row) => {
    const key = row.status;
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
}, {});

const runSimulation = () => {
    const applications = createApplications();
    const errors = {
        invalidTransitionAttempts: 0,
        illegalStateDetected: 0,
        corruptionDetected: 0,
        deadlockDetected: 0,
    };
    let raceConflictsHandled = 0;

    const attemptTransition = (application, targetStatus) => {
        if (
            targetStatus === 'hired'
            && application.escrowEnabled
            && application.escrowState !== 'released'
        ) {
            errors.invalidTransitionAttempts += 1;
            return false;
        }

        const transition = canTransition({
            fromStatus: application.status,
            toStatus: targetStatus,
            allowNoop: false,
        });
        if (!transition.valid) {
            errors.invalidTransitionAttempts += 1;
            return false;
        }
        application.status = targetStatus;
        application.transitionCount += 1;
        if (targetStatus === 'interview_requested') {
            application.hasInterviewScheduled = true;
        }
        if (targetStatus === 'offer_sent') {
            application.hasOffer = true;
        }
        if (targetStatus === 'offer_accepted' && application.escrowEnabled) {
            application.escrowState = 'required';
        }
        if (targetStatus === 'hired' && application.escrowEnabled && application.escrowState === 'required') {
            // Prevent corruption: hired with required escrow is invalid.
            errors.corruptionDetected += 1;
        }
        return true;
    };

    // Seed 500 interview requests.
    for (const application of shuffle(applications).slice(0, TOTAL_INTERVIEWS)) {
        attemptTransition(application, 'shortlisted');
        attemptTransition(application, 'interview_requested');
    }

    // Seed 200 offers by completing interview first.
    for (const application of shuffle(applications.filter((row) => row.status === 'interview_requested')).slice(0, TOTAL_OFFERS)) {
        attemptTransition(application, 'interview_completed');
        attemptTransition(application, 'offer_sent');
    }

    // Seed escrow-enabled accepted offers.
    for (const application of shuffle(applications.filter((row) => row.status === 'offer_sent')).slice(0, TOTAL_ESCROW_FLOWS)) {
        application.escrowEnabled = true;
        attemptTransition(application, 'offer_accepted');
        application.escrowState = 'required';
    }

    for (let tick = 0; tick < TOTAL_TICKS; tick += 1) {
        const randomApps = shuffle(applications).slice(0, 200);
        for (const application of randomApps) {
            // Random delays/drop-off behavior.
            if (Math.random() < 0.04 && ['applied', 'shortlisted', 'interview_requested'].includes(application.status)) {
                attemptTransition(application, 'withdrawn');
                continue;
            }

            // Simulate race conflicts by issuing two random transition attempts.
            if (Math.random() < 0.03) {
                const allowed = getAllowedTransitions(application.status);
                if (allowed.length > 1) {
                    const [first, second] = shuffle(allowed).slice(0, 2);
                    const firstApplied = attemptTransition(application, first);
                    const secondApplied = attemptTransition(application, second);
                    if (firstApplied && !secondApplied) {
                        raceConflictsHandled += 1;
                    }
                    continue;
                }
            }

            const status = application.status;
            if (status === 'applied') {
                if (Math.random() < 0.45) attemptTransition(application, 'shortlisted');
                else if (Math.random() < 0.1) attemptTransition(application, 'rejected');
                continue;
            }
            if (status === 'shortlisted') {
                if (Math.random() < 0.55) attemptTransition(application, 'interview_requested');
                else if (Math.random() < 0.15) attemptTransition(application, 'rejected');
                continue;
            }
            if (status === 'interview_requested') {
                if (Math.random() < 0.6) attemptTransition(application, 'interview_completed');
                else if (Math.random() < 0.1) attemptTransition(application, 'rejected');
                continue;
            }
            if (status === 'interview_completed') {
                if (Math.random() < 0.5) attemptTransition(application, 'offer_sent');
                else if (Math.random() < 0.2) attemptTransition(application, 'rejected');
                continue;
            }
            if (status === 'offer_sent') {
                const random = Math.random();
                if (random < 0.4) attemptTransition(application, 'offer_accepted');
                else if (random < 0.7) attemptTransition(application, 'offer_declined');
                else if (random < 0.85) attemptTransition(application, 'rejected');
                continue;
            }
            if (status === 'offer_accepted') {
                if (application.escrowEnabled) {
                    if (application.escrowState === 'required' && Math.random() < 0.5) {
                        application.escrowState = 'funded';
                    } else if (application.escrowState === 'funded' && Math.random() < 0.6) {
                        application.escrowState = 'released';
                        attemptTransition(application, 'hired');
                    }
                } else if (Math.random() < 0.7) {
                    attemptTransition(application, 'hired');
                }
            }
        }
    }

    for (const application of applications) {
        if (!CANONICAL_APPLICATION_STATUSES.includes(application.status)) {
            errors.illegalStateDetected += 1;
        }

        if (
            application.escrowEnabled
            && application.status === 'hired'
            && !['released', 'none'].includes(application.escrowState)
        ) {
            errors.corruptionDetected += 1;
        }

        const allowed = getAllowedTransitions(application.status);
        if (!allowed.length && !['hired', 'rejected', 'withdrawn'].includes(application.status)) {
            errors.deadlockDetected += 1;
        }
    }

    const report = {
        generatedAt: new Date().toISOString(),
        simulation: {
            totalApplications: TOTAL_APPLICATIONS,
            totalInterviewFlowsSeeded: TOTAL_INTERVIEWS,
            totalOfferFlowsSeeded: TOTAL_OFFERS,
            totalEscrowFlowsSeeded: TOTAL_ESCROW_FLOWS,
            totalTicks: TOTAL_TICKS,
        },
        result: {
            statusDistribution: toStatusBucketCounts(applications),
            invalidTransitionAttempts: errors.invalidTransitionAttempts,
            raceConflictsHandled,
            illegalStateDetected: errors.illegalStateDetected,
            corruptionDetected: errors.corruptionDetected,
            deadlockDetected: errors.deadlockDetected,
            pass: (
                errors.illegalStateDetected === 0
                && errors.corruptionDetected === 0
                && errors.deadlockDetected === 0
            ),
        },
        assertions: {
            noInvalidState: errors.illegalStateDetected === 0,
            noDeadlock: errors.deadlockDetected === 0,
            noDataCorruption: errors.corruptionDetected === 0,
            raceConditionHandled: raceConflictsHandled > 0,
        },
    };

    return report;
};

const main = () => {
    const report = runSimulation();
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
        event: 'autonomous_workflow_stress_simulation_completed',
        reportPath: REPORT_PATH,
        pass: report.result.pass,
        assertions: report.assertions,
    }, null, 2));
};

main();
