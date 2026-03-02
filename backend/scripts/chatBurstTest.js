#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const script = path.join(__dirname, 'socketBurstSimulation.js');
const result = spawnSync(process.execPath, [script], { stdio: 'inherit', env: process.env });
process.exit(result.status || 0);
