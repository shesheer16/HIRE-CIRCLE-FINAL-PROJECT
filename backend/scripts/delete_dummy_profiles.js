const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');

dotenv.config({ path: path.join(__dirname, '../.env') });

const cleanupProfiles = async () => {
    try {
        console.log("🧹 Connecting to DB...");
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ Connected.");

        // 1. Find Dummy Users
        const dummyPattern = /^dummy_.*@test\.com$/;
        const dummyUsers = await User.find({ email: dummyPattern });

        console.log(`🔍 Found ${dummyUsers.length} dummy users to delete.`);

        if (dummyUsers.length === 0) {
            console.log("✨ No dummy users found. Exiting.");
            return;
        }

        const dummyUserIds = dummyUsers.map(u => u._id);

        // 2. Delete Worker Profiles
        const profileResult = await WorkerProfile.deleteMany({ user: { $in: dummyUserIds } });
        console.log(`🗑️ Deleted ${profileResult.deletedCount} worker profiles.`);

        // 3. Delete Users
        const userResult = await User.deleteMany({ _id: { $in: dummyUserIds } });
        console.log(`🗑️ Deleted ${userResult.deletedCount} users.`);

        console.log("\n✅ Cleanup Complete!");

    } catch (error) {
        console.warn("💥 Error during cleanup:", error);
    } finally {
        mongoose.disconnect();
    }
};

cleanupProfiles();
