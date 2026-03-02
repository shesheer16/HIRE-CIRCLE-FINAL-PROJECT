const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/userModel');
const connectDB = require('./config/db');

dotenv.config();
connectDB();

const importData = async () => {
  try {
    const seedPassword = String(process.env.SEED_USER_PASSWORD || '').trim();
    if (seedPassword.length < 12) {
      throw new Error('SEED_USER_PASSWORD must be set with at least 12 characters');
    }

    // Clear existing users to avoid duplicates
    await User.deleteMany();

    // Create a default user
    const user = await User.create({
      name: 'Admin User',
      email: 'user@example.com',
      password: seedPassword, // Encrypted automatically by the model pre-save hook
      role: 'recruiter',
      hasCompletedProfile: true,
    });

    console.log('User Imported!');
    console.log('Email: user@example.com');
    console.log('Password: [from SEED_USER_PASSWORD]');
    process.exit();
  } catch (error) {
    console.warn(`${error}`);
    process.exit(1);
  }
};

importData();
