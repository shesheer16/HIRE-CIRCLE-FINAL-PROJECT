#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const SOURCE_DIRS = [
    'backend',
    'frontend',
    'mobile-app',
    'hire-app-web',
];

const FILE_EXT_ALLOWLIST = new Set([
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.json',
    '.env',
    '.yml',
    '.yaml',
]);

const IGNORE_SEGMENTS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    'logs',
    'tests',
    '__tests__',
    'scripts',
    'demo',
    'docs',
    'cron',
    'workers',
    'migrations',
    'match',
]);

const IGNORE_FILE_PATTERNS = [
    /\.test\./i,
    /\.spec\./i,
    /\.example(\.|$)/i,
    /development\.env$/i,
    /staging\.env$/i,
    /package-lock\.json$/i,
    /package\.json$/i,
    /test-i18n\.js$/i,
];

const IGNORE_EXACT_FILES = new Set([
    'backend/.env',
    'backend/testAuthCall.js',
    'backend/testChatDb.js',
    'backend/seeder.js',
    'frontend/package.json',
]);

const RULE_ALLOWLIST = [
    { rule: 'localhost_url', filePattern: /^backend\/index\.js$/ },
    { rule: 'localhost_url', filePattern: /^backend\/swagger\.js$/ },
    { rule: 'test_credential_marker', filePattern: /^backend\/config\/env\.js$/ },
    { rule: 'test_credential_marker', filePattern: /^backend\/utils\/sendEmail\.js$/ },
    { rule: 'test_credential_marker', filePattern: /^backend\/utils\/sendSms\.js$/ },
    { rule: 'test_credential_marker', filePattern: /^backend\/services\/startupIntegrityService\.js$/ },
    { rule: 'sandbox_smtp', filePattern: /^backend\/config\/env\.js$/ },
    { rule: 'sandbox_smtp', filePattern: /^backend\/services\/startupIntegrityService\.js$/ },
    { rule: 'sandbox_smtp', filePattern: /^backend\/utils\/sendEmail\.js$/ },
    { rule: 'mock_marker', filePattern: /^mobile-app\/App\.js$/ },
];

const SCAN_PATTERNS = [
    {
        id: 'console_log_statement',
        description: 'console.log statement found',
        regex: /\bconsole\.log\s*\(/g,
    },
    {
        id: 'todo_marker',
        description: 'TODO marker found',
        regex: /\bTODO\b/g,
    },
    {
        id: 'fixme_marker',
        description: 'FIXME marker found',
        regex: /\bFIXME\b/g,
    },
    {
        id: 'mock_marker',
        description: 'Mock marker found',
        regex: /\bmock(?:api|data|service|mode)?\b/gi,
    },
    {
        id: 'localhost_url',
        description: 'Localhost URL found',
        regex: /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/gi,
    },
    {
        id: 'qa_flag_enabled',
        description: 'QA mode enabled',
        regex: /\bQA_MODE\s*=\s*(?:1|true|yes|on)\b/gi,
    },
    {
        id: 'demo_flag_enabled',
        description: 'Demo mode enabled',
        regex: /\bDEMO_MODE\s*=\s*(?:1|true|yes|on)\b/gi,
    },
    {
        id: 'dev_flag_enabled',
        description: 'Dev mode enabled',
        regex: /\bDEV_MODE\s*=\s*(?:1|true|yes|on)\b/gi,
    },
    {
        id: 'mock_payments_enabled',
        description: 'Mock payments enabled',
        regex: /\bMOCK_PAYMENTS\s*=\s*(?:1|true|yes|on)\b/gi,
    },
    {
        id: 'sandbox_smtp',
        description: 'Sandbox SMTP reference found',
        regex: /\b(?:mailtrap|ethereal)\b/gi,
    },
    {
        id: 'test_credential_marker',
        description: 'Test credential marker found',
        regex: /\b(?:test[_-]?key|test[_-]?secret|example[_-]?token|changeme|replace_me)\b/gi,
    },
    {
        id: 'hardcoded_secret',
        description: 'Potential hardcoded secret found',
        regex: /\b(?:api[_-]?key|access[_-]?token|secret)\b\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/gi,
    },
    {
        id: 'fallback_secret',
        description: 'Fallback secret pattern found',
        regex: /\b(?:fallback[_-]?secret|default[_-]?secret)\b|process\.env\.JWT_SECRET\s*\|\|/gi,
    },
    {
        id: 'development_flag',
        description: 'Development flag enabled',
        regex: /\b(?:DEV_MODE|DEVELOPMENT_MODE)\s*=\s*(?:1|true|yes|on)\b/gi,
    },
];

const shouldIgnorePath = (absolutePath) => {
    const normalized = absolutePath.split(path.sep);
    if (normalized.some((segment) => IGNORE_SEGMENTS.has(segment))) return true;
    return IGNORE_FILE_PATTERNS.some((pattern) => pattern.test(absolutePath));
};

const iterFiles = (dirPath, files = []) => {
    if (!fs.existsSync(dirPath)) return files;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const absolute = path.join(dirPath, entry.name);
        if (shouldIgnorePath(absolute)) continue;
        if (entry.isDirectory()) {
            iterFiles(absolute, files);
            continue;
        }
        const ext = path.extname(entry.name);
        if (!FILE_EXT_ALLOWLIST.has(ext) && !entry.name.endsWith('.env')) continue;
        files.push(absolute);
    }
    return files;
};

const findings = [];
for (const sourceDir of SOURCE_DIRS) {
    const absoluteDir = path.join(repoRoot, sourceDir);
    const files = iterFiles(absoluteDir, []);
    for (const filePath of files) {
        const text = fs.readFileSync(filePath, 'utf8');
        const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
        if (IGNORE_EXACT_FILES.has(relativePath)) continue;
        SCAN_PATTERNS.forEach((pattern) => {
            const matches = text.match(pattern.regex);
            if (!matches || !matches.length) return;
            const isAllowlisted = RULE_ALLOWLIST.some((rule) => (
                rule.rule === pattern.id
                && rule.filePattern.test(relativePath)
            ));
            if (isAllowlisted) return;
            findings.push({
                filePath: relativePath,
                rule: pattern.id,
                description: pattern.description,
                sample: matches[0],
            });
        });
    }
}

if (findings.length) {
    process.stderr.write('Production artifact scan failed.\n');
    findings.slice(0, 200).forEach((finding) => {
        process.stderr.write(`- [${finding.rule}] ${finding.filePath} :: ${finding.sample}\n`);
    });
    if (findings.length > 200) {
        process.stderr.write(`... and ${findings.length - 200} more findings\n`);
    }
    process.exit(1);
}

process.stdout.write('Production artifact scan passed.\n');
