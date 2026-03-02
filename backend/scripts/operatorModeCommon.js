#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPORTS_DIR = path.resolve(__dirname, '..', 'reports');

const nowIso = () => new Date().toISOString();

const ensureReportsDir = () => {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
};

const clamp01 = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(1, numeric));
};

const safeDiv = (numerator, denominator) => {
    const num = Number(numerator || 0);
    const den = Number(denominator || 0);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0;
    return num / den;
};

const percentile = (values = [], p = 50) => {
    if (!Array.isArray(values) || values.length === 0) return 0;
    const sorted = values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);

    if (!sorted.length) return 0;

    const index = Math.ceil((Math.max(0, Math.min(100, p)) / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
};

const average = (values = []) => {
    const numbers = values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
    if (!numbers.length) return 0;
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
};

const parseJsonFromStdout = (stdout = '') => {
    const trimmed = String(stdout || '').trim();
    if (!trimmed) return null;

    try {
        const parsed = JSON.parse(trimmed);
        return parsed;
    } catch (_error) {
        // Not a single JSON payload.
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        const candidate = trimmed.slice(firstBrace, lastBrace + 1);
        try {
            return JSON.parse(candidate);
        } catch (_error) {
            // Keep trying candidate extraction below.
        }
    }

    const lastObjectStart = trimmed.lastIndexOf('{');
    if (lastObjectStart >= 0) {
        let probe = lastObjectStart;
        while (probe >= 0) {
            const candidate = trimmed.slice(probe).trim();
            try {
                return JSON.parse(candidate);
            } catch (_error) {
                // Keep scanning previous object starts.
            }
            probe = trimmed.lastIndexOf('{', probe - 1);
        }
    }

    const lines = trimmed
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .reverse();

    for (const line of lines) {
        try {
            return JSON.parse(line);
        } catch (_error) {
            // Keep scanning.
        }
    }

    return null;
};

const runNodeScript = (scriptName, { env = {}, timeoutMs = 0, captureStdout = true } = {}) => {
    const scriptPath = path.resolve(__dirname, scriptName);
    const result = spawnSync(process.execPath, [scriptPath], {
        env: {
            ...process.env,
            ...env,
        },
        encoding: 'utf8',
        stdio: captureStdout ? 'pipe' : 'inherit',
        timeout: timeoutMs > 0 ? timeoutMs : undefined,
    });

    const status = Number.isFinite(result.status) ? Number(result.status) : 1;
    const stdout = String(result.stdout || '').trim();
    const stderr = String(result.stderr || '').trim();

    return {
        status,
        stdout,
        stderr,
        timedOut: Boolean(result.error && String(result.error.message || '').includes('ETIMEDOUT')),
        json: parseJsonFromStdout(stdout),
    };
};

const writeReport = (fileName, payload) => {
    ensureReportsDir();
    const reportPath = path.resolve(REPORTS_DIR, fileName);
    fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2));
    return reportPath;
};

const parseArgs = (argv = []) => {
    const args = {};

    for (const raw of argv) {
        const token = String(raw || '').trim();
        if (!token.startsWith('--')) continue;

        const withoutPrefix = token.slice(2);
        if (!withoutPrefix) continue;

        const eqIndex = withoutPrefix.indexOf('=');
        if (eqIndex === -1) {
            args[withoutPrefix] = true;
            continue;
        }

        const key = withoutPrefix.slice(0, eqIndex);
        const value = withoutPrefix.slice(eqIndex + 1);
        args[key] = value;
    }

    return args;
};

module.exports = {
    REPORTS_DIR,
    nowIso,
    ensureReportsDir,
    clamp01,
    safeDiv,
    percentile,
    average,
    parseJsonFromStdout,
    runNodeScript,
    writeReport,
    parseArgs,
};
