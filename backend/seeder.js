const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/userModel');
const connectDB = require('./config/db');

dotenv.config();
connectDB();

const importData = async () => {
  try {
    // Clear existing users to avoid duplicates
    await User.deleteMany();

    // Create a default user
    const user = await User.create({
      email: 'user@example.com',
      password: '123456', // This will be encrypted automatically by your model
    });

    console.log('User Imported!');
    console.log('Email: user@example.com');
    console.log('Password: 123456');
    process.exit();
  } catch (error) {
    console.error(`${error}`);
    process.exit(1);
  }
};

importData();