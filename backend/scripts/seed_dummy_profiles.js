const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const Job = require('../models/Job');

dotenv.config({ path: path.join(__dirname, '../.env') });

const seedProfiles = async () => {
    try {
        console.log("🌱 Connectng to DB...");
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ Connected.");

        // 1. Get Target Job
        const job = await Job.findOne().sort({ createdAt: -1 });
        if (!job) throw new Error("No Jobs found! Create a job first.");

        console.log(`🎯 Targeting Job: ${job.title} in ${job.location} (Max Salary: ${job.salaryRange})`);
        const targetCity = job.location;
        const targetRole = job.title; // e.g. "Software Engineer"
        // Extract numeric salary roughly or default
        const maxSal = parseInt(job.salaryRange) || 15000;

        // 2. Define Dummy Data Sets
        const profiles = [];

        // Set A: 5 Perfect Matches
        for (let i = 0; i < 5; i++) {
            profiles.push({
                name: `Kevin Perfect ${i}`,
                city: targetCity,
                role: targetRole,
                salary: maxSal * 0.9, // Within budget
                skills: ['Python', 'Java', 'React'],
                exp: 3
            });
        }

        // Set B: 5 Location Mismatches
        for (let i = 0; i < 5; i++) {
            profiles.push({
                name: `Lara LocationMismatch ${i}`,
                city: "New York", // Definitely incorrect
                role: targetRole,
                salary: maxSal * 0.9,
                skills: ['Python', 'Java'],
                exp: 3
            });
        }

        // Set C: 5 Role Mismatches
        for (let i = 0; i < 5; i++) {
            profiles.push({
                name: `Randy RoleMismatch ${i}`,
                city: targetCity,
                role: "Truck Driver", // Completely diff
                salary: maxSal,
                skills: ['Driving', 'Navigation'],
                exp: 5
            });
        }

        // Set D: 5 Partial/Edge Cases (Salary High, or similar role)
        const similarRoles = ["Software Developer", "Coder", "Programmer", "IT Specialist", "Web Dev"];
        for (let i = 0; i < 5; i++) {
            profiles.push({
                name: `Eddie EdgeCase ${i}`,
                city: targetCity,
                role: similarRoles[i] || "Tech Support",
                salary: maxSal * 1.2, // Slightly over budget (120%) - Hard gate is 115% usually?
                skills: ['HTML', 'CSS'],
                exp: 1
            });
        }

        console.log(`📝 Prepared ${profiles.length} profiles to seed...`);

        // 3. Create Users and Profiles
        for (const p of profiles) {
            const email = `dummy_${Date.now()}_${Math.random().toString(36).substring(7)}@test.com`;

            // Create User
            const user = await User.create({
                name: p.name,
                email: email,
                password: 'password123',
                role: 'candidate',
                hasCompletedProfile: true,
                isVerified: true
            });

            // Create Worker Profile
            await WorkerProfile.create({
                user: user._id,
                firstName: p.name.split(' ')[0],
                lastName: p.name.split(' ')[1],
                city: p.city,
                totalExperience: p.exp,
                roleProfiles: [{
                    roleName: p.role,
                    experienceInRole: p.exp,
                    expectedSalary: p.salary,
                    skills: p.skills
                }],
                isAvailable: true
            });
            process.stdout.write('.');
        }

        console.log("\n✅ Seeding Complete!");

    } catch (error) {
        console.warn("💥 Error:", error);
    } finally {
        mongoose.disconnect();
    }
};

seedProfiles();
