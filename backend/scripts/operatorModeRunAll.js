#!/usr/bin/env node
/* eslint-disable no-console */
const {
    nowIso,
    writeReport,
    parseArgs,
    runNodeScript,
} = require('./operatorModeCommon');

const PHASE_SCRIPTS = {
    '2': 'operatorPhase2BehavioralAudit.js',
    '3': 'operatorPhase3MoneyFlowValidation.js',
    '4': 'operatorPhase4InterviewRealityCheck.js',
    '5': 'operatorPhase5TrustTest.js',
    '6': 'operatorPhase6MicroStress.js',
};

const MANUAL_PHASES = {
    phase1: {
        status: 'manual_required',
        note: 'Lock system (freeze features, env lock, DB snapshot, monitoring, disable experimental flags).',
    },
    phase7: {
        status: 'manual_required',
        note: 'Referral ignition campaign and incentive rollout.',
    },
    phase8: {
        status: 'manual_required',
        note: 'Reach first 100 active users (interview+apply or job posted).',
    },
    phase9: {
        status: 'manual_required',
        note: 'Retention-first observation before scaling decisions.',
    },
    phase10: {
        status: 'manual_required',
        note: 'Regional expansion only after stability, retention, and money-flow gates pass.',
    },
};

const normalizePhaseList = (value) => {
    if (!value) return ['2', '3', '4', '5', '6'];

    return String(value)
        .split(',')
        .map((token) => token.trim())
        .filter((token) => Object.prototype.hasOwnProperty.call(PHASE_SCRIPTS, token));
};

const run = async () => {
    const args = parseArgs(process.argv.slice(2));
    const phases = normalizePhaseList(args.phases || process.env.OPS_PHASES);

    if (!phases.length) {
        console.warn('No valid phases selected. Use --phases=2,3,4,5,6');
        process.exit(1);
    }

    const startedAt = nowIso();

    const phaseResults = [];

    for (const phase of phases) {
        const scriptName = PHASE_SCRIPTS[phase];
        const env = phase === '2'
            ? { OPS_STAGE_THRESHOLD: String(process.env.OPS_STAGE_THRESHOLD || '0.5') }
            : {};
        const execution = runNodeScript(scriptName, {
            timeoutMs: 6 * 60 * 1000,
            env,
        });

        phaseResults.push({
            phase: `phase${phase}`,
            script: scriptName,
            status: execution.status,
            passed: execution.status === 0,
            summary: execution.json || null,
            stderr: execution.stderr || null,
        });
    }

    const overallPass = phaseResults.every((row) => row.passed);

    const report = {
        mode: 'launch_and_dominate',
        generatedAt: nowIso(),
        startedAt,
        completedAt: nowIso(),
        manualPhases: MANUAL_PHASES,
        automatedPhases: phaseResults,
        overallPass,
    };

    const reportPath = writeReport('operator-controlled-deployment-run.json', report);

    console.log(JSON.stringify({
        mode: 'launch_and_dominate',
        phases,
        overallPass,
        reportPath,
    }, null, 2));

    process.exit(overallPass ? 0 : 1);
};

run();
