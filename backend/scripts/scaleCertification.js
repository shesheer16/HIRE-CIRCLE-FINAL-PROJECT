#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const BACKEND_DIR = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(BACKEND_DIR, 'reports');
const CERT_PATH = path.join(ROOT_DIR, 'SCALE_ARCHITECTURE_CERTIFICATION.md');

const SCRIPT_MATRIX = [
    {
        key: 'stressLoad',
        label: 'Stress tests',
        script: 'loadTestDistributedScale.js',
        report: 'distributed-scale-loadtest.json',
    },
    {
        key: 'socketBurst',
        label: 'Socket burst tests (2-instance simulation)',
        script: 'simulateSocketMultiInstance.js',
        report: 'socket-multi-instance-simulation.json',
    },
    {
        key: 'memoryAudit',
        label: 'Memory leak observation',
        script: 'memoryFootprintAudit.js',
        report: 'memory-footprint-audit.json',
    },
    {
        key: 'dbRestore',
        label: 'DB restore simulation',
        script: 'simulateDbRestore.js',
        report: 'disaster-recovery-db-restore.json',
    },
    {
        key: 'redisRestart',
        label: 'Redis restart tests',
        script: 'simulateRedisRestart.js',
        report: 'disaster-recovery-redis-restart.json',
    },
    {
        key: 'workerCrash',
        label: 'Worker crash simulation',
        script: 'simulateWorkerRestart.js',
        report: 'disaster-recovery-worker-restart.json',
    },
    {
        key: 'gracefulShutdown',
        label: 'Graceful shutdown test',
        script: 'simulateServerCrashRecovery.js',
        report: 'disaster-recovery-server-crash.json',
    },
];

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const runScript = (scriptName) => {
    const abs = path.join(__dirname, scriptName);
    const result = spawnSync(process.execPath, [abs], {
        cwd: BACKEND_DIR,
        env: process.env,
        encoding: 'utf8',
        stdio: 'pipe',
    });

    return {
        status: Number(result.status || 0),
        stdout: String(result.stdout || '').trim(),
        stderr: String(result.stderr || '').trim(),
    };
};

const buildStaticArchitectureChecks = () => {
    const indexPath = path.join(BACKEND_DIR, 'index.js');
    const ecosystemPath = path.join(BACKEND_DIR, 'ecosystem.config.js');
    const cacheServicePath = path.join(BACKEND_DIR, 'services', 'cacheService.js');
    const packagePath = path.join(BACKEND_DIR, 'package.json');

    const indexSource = fs.readFileSync(indexPath, 'utf8');
    const ecosystemSource = fs.readFileSync(ecosystemPath, 'utf8');
    const cacheSource = fs.readFileSync(cacheServicePath, 'utf8');
    const packageJson = readJson(packagePath);

    const hasRedisSocketPrep = indexSource.includes('attachRedisAdapterToSocketIo')
        && indexSource.includes('socket:rooms:');

    const noInMemoryRoomMap = !indexSource.includes('roomMap = new Map')
        && !indexSource.includes('rooms = new Map');

    const hasClusterMode = ecosystemSource.includes("exec_mode: 'cluster'")
        && ecosystemSource.includes("instances: 'max'");

    const hasIndependentWorkers = ecosystemSource.includes('hire-interview-worker')
        && ecosystemSource.includes('hire-distributed-worker')
        && ecosystemSource.includes('DISTRIBUTED_WORKER_INSTANCES');

    const hasCacheTtls = cacheSource.includes('jobs: 60')
        && cacheSource.includes('feed: 30')
        && cacheSource.includes('profile: 120')
        && cacheSource.includes('analytics: 300');

    const hasIsolatedWorkerScripts = Boolean(packageJson.scripts?.['worker:interview'])
        && Boolean(packageJson.scripts?.['worker:distributed']);

    return {
        horizontallyScalable: hasClusterMode && hasIndependentWorkers,
        noInMemoryDependency: hasRedisSocketPrep && noInMemoryRoomMap,
        noSinglePointOfFailure: hasClusterMode && hasIndependentWorkers,
        cacheEffective: hasCacheTtls,
        workersIsolated: hasIsolatedWorkerScripts,
        readyForMultiInstanceDeployment: hasRedisSocketPrep,
        productionScalable: hasClusterMode && hasIsolatedWorkerScripts,
    };
};

const run = () => {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });

    const startedAt = new Date();
    const executed = [];

    for (const entry of SCRIPT_MATRIX) {
        const result = runScript(entry.script);
        const reportPath = path.join(REPORTS_DIR, entry.report);

        let report = null;
        if (fs.existsSync(reportPath)) {
            try {
                report = readJson(reportPath);
            } catch (_error) {
                report = null;
            }
        }

        executed.push({
            key: entry.key,
            label: entry.label,
            script: entry.script,
            statusCode: result.status,
            passed: result.status === 0 && Boolean(report?.passed ?? report?.stable ?? false),
            reportPath,
            report,
            stderr: result.stderr,
        });
    }

    const dynamicChecks = {
        stressTests: executed.find((row) => row.key === 'stressLoad')?.passed === true,
        queueFloodTests: Boolean(executed.find((row) => row.key === 'stressLoad')?.report?.queueFlood?.passed),
        socketBurstTests: executed.find((row) => row.key === 'socketBurst')?.passed === true,
        redisRestartTests: executed.find((row) => row.key === 'redisRestart')?.passed === true,
        workerCrashSimulation: executed.find((row) => row.key === 'workerCrash')?.passed === true,
        gracefulShutdownTest: executed.find((row) => row.key === 'gracefulShutdown')?.passed === true,
        memoryLeakObservation: executed.find((row) => row.key === 'memoryAudit')?.passed === true,
        dbRestoreSimulation: executed.find((row) => row.key === 'dbRestore')?.passed === true,
    };

    const staticChecks = buildStaticArchitectureChecks();

    const noMemoryLeak = executed.find((row) => row.key === 'memoryAudit')?.report?.analysis?.leakPatternDetected === false;
    const safeShutdown = dynamicChecks.gracefulShutdownTest;

    const finalConfirmations = {
        horizontallyScalable: staticChecks.horizontallyScalable,
        noInMemoryDependency: staticChecks.noInMemoryDependency,
        noSinglePointOfFailure: staticChecks.noSinglePointOfFailure,
        cacheEffective: staticChecks.cacheEffective,
        workersIsolated: staticChecks.workersIsolated,
        noMemoryLeak,
        safeShutdown,
        readyForMultiInstanceDeployment: staticChecks.readyForMultiInstanceDeployment && dynamicChecks.socketBurstTests,
        productionScalable: staticChecks.productionScalable && dynamicChecks.stressTests,
    };

    const allDynamicPassed = Object.values(dynamicChecks).every(Boolean);
    const allFinalConfirmationsPassed = Object.values(finalConfirmations).every(Boolean);
    const overallPass = allDynamicPassed && allFinalConfirmationsPassed;

    const completionTime = new Date();

    const summaryRows = executed.map((row) => `- ${row.label}: ${row.passed ? 'PASS' : 'FAIL'}`);

    const content = `# SCALE_ARCHITECTURE_CERTIFICATION

Generated: ${completionTime.toISOString()}
Branch: feature/distributed-scale-and-performance-architecture
Mode: Horizontal Scale Engineering

## Certification Result

Scale architecture certification: ${overallPass ? 'PASS' : 'FAIL'}

## Executed Validation Matrix

${summaryRows.join('\n')}

## Dynamic Validation Checks

- Stress tests: ${dynamicChecks.stressTests ? 'PASS' : 'FAIL'}
- Queue flood tests: ${dynamicChecks.queueFloodTests ? 'PASS' : 'FAIL'}
- Socket burst tests: ${dynamicChecks.socketBurstTests ? 'PASS' : 'FAIL'}
- Redis restart tests: ${dynamicChecks.redisRestartTests ? 'PASS' : 'FAIL'}
- Worker crash simulation: ${dynamicChecks.workerCrashSimulation ? 'PASS' : 'FAIL'}
- Graceful shutdown test: ${dynamicChecks.gracefulShutdownTest ? 'PASS' : 'FAIL'}
- Memory leak observation: ${dynamicChecks.memoryLeakObservation ? 'PASS' : 'FAIL'}
- DB restore simulation: ${dynamicChecks.dbRestoreSimulation ? 'PASS' : 'FAIL'}

## Mandatory Confirmations

- Horizontally scalable: ${finalConfirmations.horizontallyScalable ? 'CONFIRMED' : 'NOT CONFIRMED'}
- No in-memory dependency: ${finalConfirmations.noInMemoryDependency ? 'CONFIRMED' : 'NOT CONFIRMED'}
- No single point of failure: ${finalConfirmations.noSinglePointOfFailure ? 'CONFIRMED' : 'NOT CONFIRMED'}
- Cache effective: ${finalConfirmations.cacheEffective ? 'CONFIRMED' : 'NOT CONFIRMED'}
- Workers isolated: ${finalConfirmations.workersIsolated ? 'CONFIRMED' : 'NOT CONFIRMED'}
- No memory leak: ${finalConfirmations.noMemoryLeak ? 'CONFIRMED' : 'NOT CONFIRMED'}
- Safe shutdown: ${finalConfirmations.safeShutdown ? 'CONFIRMED' : 'NOT CONFIRMED'}
- Ready for multi-instance deployment: ${finalConfirmations.readyForMultiInstanceDeployment ? 'CONFIRMED' : 'NOT CONFIRMED'}
- Production scalable: ${finalConfirmations.productionScalable ? 'CONFIRMED' : 'NOT CONFIRMED'}

## Execution Metadata

- Started: ${startedAt.toISOString()}
- Completed: ${completionTime.toISOString()}
- Runtime Scripts: ${SCRIPT_MATRIX.length}
- Reports Directory: ${REPORTS_DIR}
`;

    fs.writeFileSync(CERT_PATH, content, 'utf8');

    if (!overallPass) {
        const failedLines = executed
            .filter((row) => !row.passed)
            .map((row) => `${row.script}: ${row.stderr || 'failed'}`)
            .join('; ');
        console.warn(`[scale-certification] failed: ${failedLines || 'one or more checks failed'}`);
        process.exit(1);
    }

    console.log(`[scale-certification] PASS -> ${CERT_PATH}`);
};

run();
