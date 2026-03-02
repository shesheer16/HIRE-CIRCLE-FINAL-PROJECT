#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const preferred = path.join(__dirname, 'stressSmartInterviewV4.js');
const fallback = path.join(__dirname, 'loadTestInterview.js');
const script = process.env.SMART_INTERVIEW_LOAD_SCRIPT || (require('fs').existsSync(preferred) ? preferred : fallback);

const result = spawnSync(process.execPath, [script], { stdio: 'inherit', env: process.env });
process.exit(result.status || 0);
