const fs = require('fs');
const path = require('path');

const TRACE_FILE_PATH = String(process.env.SMART_INTERVIEW_TRACE_LOG_PATH || '')
    .trim()
    || path.join(__dirname, '../reports/SMART_INTERVIEW_TRACE_LOG.md');

const toTraceString = (value, maxLength = 4000) => {
    const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const normalized = String(raw || '').trim();
    if (!normalized) return '';
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength)}\n...[truncated]`;
};

const safeTime = () => new Date().toISOString();

const appendSmartInterviewTrace = async ({
    traceId = '',
    phase = '',
    data = {},
} = {}) => {
    const normalizedTraceId = String(traceId || '').trim() || 'unknown-trace';
    const normalizedPhase = String(phase || '').trim() || 'unknown-phase';
    const body = toTraceString(data);
    const block = [
        '',
        `## ${safeTime()} | ${normalizedTraceId} | ${normalizedPhase}`,
        '```json',
        body || '{}',
        '```',
        '',
    ].join('\n');

    await fs.promises.mkdir(path.dirname(TRACE_FILE_PATH), { recursive: true });
    await fs.promises.appendFile(TRACE_FILE_PATH, block, 'utf8');
};

const appendSmartInterviewTraceSyncSafe = (payload = {}) => {
    try {
        const normalizedTraceId = String(payload?.traceId || '').trim() || 'unknown-trace';
        const normalizedPhase = String(payload?.phase || '').trim() || 'unknown-phase';
        const body = toTraceString(payload?.data || {});
        const block = [
            '',
            `## ${safeTime()} | ${normalizedTraceId} | ${normalizedPhase}`,
            '```json',
            body || '{}',
            '```',
            '',
        ].join('\n');
        fs.mkdirSync(path.dirname(TRACE_FILE_PATH), { recursive: true });
        fs.appendFileSync(TRACE_FILE_PATH, block, 'utf8');
    } catch (_error) {
        // Deliberately swallow trace write errors; tracing must never break interview flow.
    }
};

module.exports = {
    TRACE_FILE_PATH,
    appendSmartInterviewTrace,
    appendSmartInterviewTraceSyncSafe,
};
