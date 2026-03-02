const mongoose = require('mongoose');
const dotenv = require('dotenv');
const axios = require('axios');
const path = require('path');

// Load Env
dotenv.config({ path: path.join(__dirname, '../.env') });

const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');
const User = require('../models/userModel');

const connectDB = require('../config/db');

const runDebug = async () => {
    console.log('🔌 calling connectDB()...');
    await connectDB();
    console.log('✅ Connected via shared module');

    try {
        console.log('\n🔍 --- DEBUG MATCHING DIAGNOSTICS ---\n');

        // 1. Fetch Latest Job
        const job = await Job.findOne({ isOpen: true }).sort({ createdAt: -1 });
        if (!job) {
            console.log("❌ No Open Jobs found.");
            process.exit();
        }

        console.log(`📋 LATEST JOB: "${job.title}"`);
        console.log(`   ID: ${job._id}`);
        console.log(`   Location: "${job.location}"`);
        console.log(`   Max Salary: ${job.maxSalary} (Range: ${job.salaryRange})`);
        console.log(`   Requirements: ${job.requirements}\n`);

        // 2. Fetch Available Workers
        const workers = await WorkerProfile.find({ isAvailable: true }).limit(5).populate('user');
        console.log(`👷 AVAILABLE WORKERS: ${workers.length} found (showing top 5)`);

        const validWorkers = workers.filter(w => w.user && w.roleProfiles?.length > 0);
        console.log(`   Valid Workers (Processable): ${validWorkers.length}\n`);

        if (validWorkers.length === 0) {
            console.log("❌ No valid workers found to match against.");
            process.exit();
        }

        // 3. Inspect Worker Data
        validWorkers.forEach(w => {
            console.log(`   👤 Worker: ${w.firstName} (${w.city})`);
            w.roleProfiles.forEach(r => {
                console.log(`      - Role: "${r.roleName}" | Exp: ${r.experienceInRole} | Sal: ${r.expectedSalary}`);
            });
        });
        console.log('\n-----------------------------------');

        // 4. Construct Python Payload
        const workerPayload = [];
        validWorkers.forEach(w => {
            w.roleProfiles.forEach(r => {
                workerPayload.push({
                    id: w._id.toString(),
                    userId: w.user._id.toString(),
                    name: w.user.name || w.firstName,
                    city: w.city,
                    isVerified: false,
                    preferredShift: 'Flexible',
                    roleName: r.roleName,
                    expectedSalary: r.expectedSalary || 0,
                    experienceInRole: r.experienceInRole || 0,
                    skills: r.skills || [],
                    licenses: []
                });
            });
        });

        const jobPayload = {
            id: job._id.toString(),
            title: job.title,
            location: job.location,
            maxSalary: job.maxSalary || (parseInt(job.salaryRange) || 0),
            requirements: job.requirements || [],
            shift: job.shift || 'Flexible',
            mandatoryLicenses: job.mandatoryLicenses || []
        };

        console.log("\n📦 PAYLOAD TO PYTHON:");
        console.log("   Job:", JSON.stringify(jobPayload, null, 2));
        console.log("   Workers (First 1):", JSON.stringify(workerPayload.slice(0, 1), null, 2));

        // 5. Call Python Logic Engine
        console.log("\n🐍 Sending Request to Python Engine...");
        console.log(`   Endpoint: http://localhost:8001/calculate-matches`);

        try {
            const pyResponse = await axios.post('http://localhost:8001/calculate-matches', {
                job: jobPayload,
                workers: workerPayload
            }, { timeout: 3000 });

            console.log(`\n✅ PYTHON RESPONSE: ${pyResponse.status} ${pyResponse.statusText}`);
            console.log(`   Matches Found: ${pyResponse.data.length}`);

            if (pyResponse.data.length > 0) {
                console.log("\n   🏆 TOP MATCHES:");
                pyResponse.data.forEach(m => {
                    console.log(`      - [${m.matchScore}%] WorkerID: ${m.workerId} | Tier: ${m.tier}`);
                    if (m.breakdown) console.log(`        Breakdown: ${JSON.stringify(m.breakdown)}`);
                });
            } else {
                console.log("\n   ⚠️  NO MATCHES RETURNED.");
                console.log("   Potential Causes:");
                console.log("   1. Location Mismatch (Strict String Check)");
                console.log("   2. Salary Expectation > Job Max + 15%");
                console.log("   3. Role Name Mismatch (Token overlap required)");
            }

        } catch (err) {
            if (err.code === 'ECONNREFUSED') {
                console.log("❌ CONNECTION REFUSED: Is the Python service running on port 8001?");
            } else {
                console.log("❌ PYTHON ERROR:", err.message);
                if (err.response) {
                    console.log("   Response Data:", err.response.data);
                }
            }
        }

    } catch (err) {
        console.warn('❌ SCRIPT ERROR:', err);
    } finally {
        mongoose.connection.close();
        console.log('\n🔒 DB Disconnected');
    }
};

runDebug();
