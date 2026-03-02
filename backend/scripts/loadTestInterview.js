#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { getInterviewQueueDepth } = require('../services/sqsInterviewQueue');

const apiBaseUrl = process.env.LOAD_TEST_API_URL || 'http://localhost:3000';
const authToken = process.env.LOAD_TEST_TOKEN || '';
const videoFilePath = process.env.LOAD_TEST_VIDEO_PATH || path.join(__dirname, '../test-video.mp4');
const concurrentUploads = Number.parseInt(process.env.LOAD_TEST_CONCURRENCY || '200', 10);
const totalUploads = Number.parseInt(process.env.LOAD_TEST_TOTAL_UPLOADS || '1000', 10);
const trackProcessing = String(process.env.LOAD_TEST_TRACK_PROCESSING || 'true').toLowerCase() === 'true';
const processingSampleSize = Number.parseInt(process.env.LOAD_TEST_PROCESSING_SAMPLE_SIZE || '100', 10);
const processingPollIntervalMs = Number.parseInt(process.env.LOAD_TEST_PROCESSING_POLL_INTERVAL_MS || '5000', 10);
const processingMaxWaitMs = Number.parseInt(process.env.LOAD_TEST_PROCESSING_MAX_WAIT_MS || String(20 * 60 * 1000), 10);

if (!authToken) {
    console.warn('Missing LOAD_TEST_TOKEN.');
    process.exit(1);
}

if (!fs.existsSync(videoFilePath)) {
    console.warn(`Video file not found at ${videoFilePath}`);
    process.exit(1);
}

const percentile = (arr, p) => {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
};

const uploadOnce = async (sequence) => {
    const form = new FormData();
    form.append('video', fs.createReadStream(videoFilePath), {
        filename: `loadtest-${sequence}.mp4`,
        contentType: 'video/mp4',
    });

    const startedAt = Date.now();
    try {
        const response = await axios.post(`${apiBaseUrl}/api/v2/upload/video`, form, {
            headers: {
                ...form.getHeaders(),
                Authorization: `Bearer ${authToken}`,
            },
            timeout: 30000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        return {
            ok: response.status >= 200 && response.status < 300,
            latencyMs: Date.now() - startedAt,
            status: response.status,
            processingId: response.data?.processingId || null,
        };
    } catch (error) {
        return {
            ok: false,
            latencyMs: Date.now() - startedAt,
            status: error?.response?.status || 0,
            processingId: null,
        };
    }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const monitorProcessing = async (sampleResults = []) => {
    if (!sampleResults.length) {
        return {
            processingCount: 0,
            completedCount: 0,
            failedCount: 0,
            pendingCount: 0,
            throughputPerMinute: 0,
            processingP50Ms: 0,
            processingP95Ms: 0,
        };
    }

    const unresolved = new Map(
        sampleResults.map((item) => [
            item.processingId,
            {
                startedAt: item.startedAt,
                status: 'processing',
            },
        ])
    );

    const completedDurations = [];
    let completedCount = 0;
    let failedCount = 0;
    const watchStartedAt = Date.now();

    while (unresolved.size && Date.now() - watchStartedAt < processingMaxWaitMs) {
        const ids = Array.from(unresolved.keys());
        await Promise.all(ids.map(async (processingId) => {
            try {
                const response = await axios.get(
                    `${apiBaseUrl}/api/v2/interview-processing/${processingId}`,
                    {
                        headers: {
                            Authorization: `Bearer ${authToken}`,
                        },
                        timeout: 15000,
                    }
                );
                const status = String(response.data?.status || '').toLowerCase();
                if (status === 'completed') {
                    const meta = unresolved.get(processingId);
                    if (meta?.startedAt) {
                        completedDurations.push(Date.now() - meta.startedAt);
                    }
                    completedCount += 1;
                    unresolved.delete(processingId);
                } else if (status === 'failed') {
                    failedCount += 1;
                    unresolved.delete(processingId);
                }
            } catch (error) {
                // keep unresolved and retry on next poll
            }
        }));

        if (unresolved.size) {
            await sleep(processingPollIntervalMs);
        }
    }

    const elapsedMinutes = Math.max((Date.now() - watchStartedAt) / 60000, 1 / 60);
    return {
        processingCount: sampleResults.length,
        completedCount,
        failedCount,
        pendingCount: unresolved.size,
        throughputPerMinute: Number((completedCount / elapsedMinutes).toFixed(2)),
        processingP50Ms: Math.round(percentile(completedDurations, 50)),
        processingP95Ms: Math.round(percentile(completedDurations, 95)),
    };
};

const run = async () => {
    console.log(`Starting load test: ${totalUploads} uploads, concurrency ${concurrentUploads}`);
    const queueDepthBefore = await getInterviewQueueDepth().catch(() => null);

    const latencies = [];
    const statuses = {};
    const uploadResults = [];
    let completed = 0;
    let running = 0;
    let index = 0;

    await new Promise((resolve) => {
        const schedule = () => {
            while (running < concurrentUploads && index < totalUploads) {
                const current = index++;
                running += 1;

                uploadOnce(current)
                    .then((result) => {
                        latencies.push(result.latencyMs);
                        statuses[result.status] = (statuses[result.status] || 0) + 1;
                        uploadResults.push({
                            ...result,
                            startedAt: Date.now() - result.latencyMs,
                        });
                    })
                    .finally(() => {
                        running -= 1;
                        completed += 1;
                        if (completed % 25 === 0 || completed === totalUploads) {
                            console.log(`Progress: ${completed}/${totalUploads}`);
                        }
                        if (completed === totalUploads) {
                            resolve();
                        } else {
                            schedule();
                        }
                    });
            }
        };
        schedule();
    });

    const queueDepthAfter = await getInterviewQueueDepth().catch(() => null);
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const successfulWithProcessingId = uploadResults.filter((item) => item.ok && item.processingId);

    let processingStats = {
        processingCount: 0,
        completedCount: 0,
        failedCount: 0,
        pendingCount: 0,
        throughputPerMinute: 0,
        processingP50Ms: 0,
        processingP95Ms: 0,
    };

    if (trackProcessing && successfulWithProcessingId.length) {
        const sample = successfulWithProcessingId.slice(0, Math.max(1, processingSampleSize));
        console.log(`Tracking worker processing for ${sample.length} sampled jobs...`);
        processingStats = await monitorProcessing(sample);
    }

    console.log('\n=== Interview Load Test Report ===');
    console.log(`API Base URL: ${apiBaseUrl}`);
    console.log(`Uploads attempted: ${totalUploads}`);
    console.log(`Concurrent uploads: ${concurrentUploads}`);
    console.log(`Latency p50 (ms): ${Math.round(p50)}`);
    console.log(`Latency p95 (ms): ${Math.round(p95)}`);
    console.log(`Queue depth before: ${queueDepthBefore === null ? 'N/A' : queueDepthBefore}`);
    console.log(`Queue depth after: ${queueDepthAfter === null ? 'N/A' : queueDepthAfter}`);
    console.log(`Worker throughput (jobs/min): ${processingStats.throughputPerMinute}`);
    console.log(`Processing sample size: ${processingStats.processingCount}`);
    console.log(`Processing completed: ${processingStats.completedCount}`);
    console.log(`Processing failed: ${processingStats.failedCount}`);
    console.log(`Processing pending after timeout: ${processingStats.pendingCount}`);
    console.log(`Processing p50 (ms): ${processingStats.processingP50Ms}`);
    console.log(`Processing p95 (ms): ${processingStats.processingP95Ms}`);
    console.log(`Status breakdown: ${JSON.stringify(statuses, null, 2)}`);
};

run().catch((error) => {
    console.warn('Load test failed:', error.message);
    process.exit(1);
});
