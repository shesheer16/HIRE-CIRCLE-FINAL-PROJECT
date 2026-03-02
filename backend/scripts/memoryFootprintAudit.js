#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '..', 'reports', 'memory-footprint-audit.json');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toMb = (bytes) => Number((Number(bytes || 0) / (1024 * 1024)).toFixed(2));

const snapshot = (label) => {
    const usage = process.memoryUsage();
    return {
        label,
        timestamp: new Date().toISOString(),
        rssMb: toMb(usage.rss),
        heapTotalMb: toMb(usage.heapTotal),
        heapUsedMb: toMb(usage.heapUsed),
        externalMb: toMb(usage.external),
    };
};

const settleGC = async () => {
    if (typeof global.gc === 'function') {
        for (let i = 0; i < 3; i += 1) {
            global.gc();
            // eslint-disable-next-line no-await-in-loop
            await wait(25);
        }
        return;
    }

    await wait(150);
};

const simulateSmartInterviewPeak = async () => {
    const records = [];
    for (let i = 0; i < 1200; i += 1) {
        records.push({
            interviewId: `si-${i}`,
            transcript: `candidate-${i} `.repeat(30),
            embeddings: Array.from({ length: 32 }, (_, j) => Number(((i + j) / 1000).toFixed(3))),
            quality: Number(((i % 100) / 100).toFixed(2)),
        });
    }

    const score = records.reduce((acc, item) => acc + item.quality, 0);
    await wait(50);

    return {
        simulatedRecords: records.length,
        aggregateScore: Number(score.toFixed(2)),
    };
};

const simulateChatBurstPeak = async () => {
    const messages = [];
    for (let i = 0; i < 15000; i += 1) {
        messages.push({
            roomId: `room-${i % 500}`,
            text: `message-${i}`,
            senderId: `user-${i % 1000}`,
            dedupeKey: `dedupe-${i}`,
        });
    }

    const uniqueRooms = new Set(messages.map((row) => row.roomId)).size;
    await wait(30);

    return {
        simulatedMessages: messages.length,
        uniqueRooms,
    };
};

const simulateFeedBurstPeak = async () => {
    const feedRows = [];
    for (let i = 0; i < 30000; i += 1) {
        feedRows.push({
            id: `post-${i}`,
            authorId: `user-${i % 5000}`,
            score: Number(((i % 100) / 100).toFixed(2)),
            tags: ['jobs', 'hiring', `city-${i % 30}`],
            payload: {
                title: `Post ${i}`,
                body: `content-${i}`,
            },
        });
    }

    const top = feedRows
        .sort((a, b) => b.score - a.score)
        .slice(0, 50)
        .map((row) => row.id);

    await wait(40);

    return {
        simulatedFeedRows: feedRows.length,
        topSampleCount: top.length,
    };
};

const run = async () => {
    const stages = [];

    await settleGC();
    const baseline = snapshot('baseline');

    const smartInterviewResult = await simulateSmartInterviewPeak();
    stages.push({
        stage: 'smartInterviewPeakUsage',
        ...smartInterviewResult,
        memory: snapshot('smartInterviewPeakUsage'),
    });

    await settleGC();

    const chatResult = await simulateChatBurstPeak();
    stages.push({
        stage: 'chatBurstUsage',
        ...chatResult,
        memory: snapshot('chatBurstUsage'),
    });

    await settleGC();

    const feedResult = await simulateFeedBurstPeak();
    stages.push({
        stage: 'feedBurstUsage',
        ...feedResult,
        memory: snapshot('feedBurstUsage'),
    });

    await settleGC();
    const finalSnapshot = snapshot('postAudit');

    const peakHeapMb = Math.max(...stages.map((stage) => stage.memory.heapUsedMb), baseline.heapUsedMb, finalSnapshot.heapUsedMb);
    const baselineHeapMb = baseline.heapUsedMb;
    const residualHeapDeltaMb = Number((finalSnapshot.heapUsedMb - baselineHeapMb).toFixed(2));

    const noLeakPattern = residualHeapDeltaMb <= 35;

    const report = {
        generatedAt: new Date().toISOString(),
        runtime: {
            nodeVersion: process.version,
            gcExposed: typeof global.gc === 'function',
        },
        baseline,
        stages,
        postAudit: finalSnapshot,
        analysis: {
            baselineHeapMb,
            peakHeapMb: Number(peakHeapMb.toFixed(2)),
            residualHeapDeltaMb,
            leakPatternDetected: !noLeakPattern,
            passed: noLeakPattern,
        },
        passed: noLeakPattern,
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(noLeakPattern ? 0 : 1);
};

run().catch((error) => {
    console.warn('[audit:memory-footprint] failed:', error.message);
    process.exit(1);
});
