const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/userModel');
const { generateToken, generateRefreshToken } = require('../utils/generateToken');
const BetaCode = require('../models/BetaCode');
const { triggerWelcomeSeries } = require('../services/marketingService');

// @desc    Register a new user
// @route   POST /api/users/register
// @access  Public
const registerUser = async (req, res) => {
  const { name, email, role, password, betaCode, referredByCode } = req.body;
  const crypto = require('crypto');

  try {
    // 1. Validate Beta Code (MVP approach: fail early if missing/invalid)
    // TEMPORARY PROMPT FIX: Beta code is now optional for testing
    let validCode = null;
    if (betaCode) {
      validCode = await BetaCode.findOne({ code: betaCode.toUpperCase(), isUsed: false });
      if (!validCode) {
        return res.status(400).json({ message: 'Invalid or already used Beta Code' });
      }
    }

    const userExists = await User.findOne({ email });

    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Handle Referral logic
    let referredByUserId = null;
    if (referredByCode) {
      const referringUser = await User.findOne({ referralCode: referredByCode.toUpperCase() });
      if (referringUser) {
        referredByUserId = referringUser._id;

        // Reward the referrer: give 1 extra credit
        if (referringUser.subscription && typeof referringUser.subscription.credits === 'number') {
          referringUser.subscription.credits += 1;
        } else {
          referringUser.subscription = { ...referringUser.subscription, credits: 4 }; // 3 default + 1
        }
        await referringUser.save({ validateBeforeSave: false });
        console.log(`🎁 User ${referringUser._id} rewarded for referral!`);
      }
    }

    // Generate Verification Token
    const verificationToken = crypto.randomBytes(20).toString('hex');
    // Generate new unique referral code for this user
    const newReferralCode = crypto.randomBytes(3).toString('hex').toUpperCase() + Date.now().toString().slice(-4);

    const user = await User.create({
      name,
      email,
      role: role || 'candidate',
      password,
      verificationToken,
      referralCode: newReferralCode,
      referredBy: referredByUserId
    });

    if (user) {
      // Send Verification Email
      const verifyUrl = `http://localhost:5001/api/users/verifyemail/${verificationToken}`;
      const message = `Please confirm your email by clicking here: \n\n ${verifyUrl}`;

      try {
        const sendEmail = require('../utils/sendEmail');
        await sendEmail({
          email: user.email,
          subject: 'Email Verification',
          message,
        });
      } catch (err) {
        console.error('Verification email failed', err);
        // We still allow registration, but user is not verified.
      }

      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        token: generateToken(user._id),
      });

      // Trigger automated marketing welcome flow
      triggerWelcomeSeries(user);

      // Mark Beta Code as used
      if (validCode) {
        validCode.isUsed = true;
        validCode.usedBy = user._id;
        await validCode.save();
      }

    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ... authUser is unchanged ...

// @desc    Verify Email
// @route   PUT /api/users/verifyemail/:verificationtoken
// @access  Public
const verifyEmail = async (req, res) => {
  const verificationToken = req.params.verificationtoken;

  try {
    const user = await User.findOne({ verificationToken });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or Expired Token' });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();

    res.status(200).json({ success: true, data: 'Email Verified' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Forgot Password
// @route   POST /api/users/forgotpassword
// @access  Public
const forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get Reset Token
    const resetToken = user.getResetPasswordToken();

    await user.save({ validateBeforeSave: false });

    // Create Reset URL
    const resetUrl = `${process.env.FRONTEND_URL || 'exp://localhost:19000'}/reset-password/${resetToken}`;

    const message = `You are receiving this email because you (or someone else) has requested the reset of a password. Please make a PUT request to: \n\n ${resetUrl}`;

    try {
      const sendEmail = require('../utils/sendEmail');
      await sendEmail({
        email: user.email,
        subject: 'Password Reset Token',
        message,
      });

      res.status(200).json({ success: true, data: 'Email sent' });
    } catch (err) {
      console.error(err);
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;

      await user.save({ validateBeforeSave: false });

      return res.status(500).json({ message: 'Email could not be sent' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Reset Password
// @route   PUT /api/users/resetpassword/:resettoken
// @access  Public
const resetPassword = async (req, res) => {
  const crypto = require('crypto');
  // Get hashed token
  const resetPasswordToken = crypto
    .createHash('sha256')
    .update(req.params.resettoken)
    .digest('hex');

  try {
    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid token' });
    }

    // Set new password
    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    res.status(200).json({
      success: true,
      data: 'Password Reset Success',
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};



// @desc    Auth user & get token (LOGIN)
// @route   POST /api/users/login
// @access  Public
const authUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check if account is locked
    if (user.lockUntil && user.lockUntil > Date.now()) {
      return res.status(403).json({ message: 'Account locked. Try again later.' });
    }

    if (await user.matchPassword(password)) {
      // Success: Reset attempts
      user.loginAttempts = 0;
      user.lockUntil = undefined;
      await user.save();

      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
        token: generateToken(user._id),
        refreshToken: generateRefreshToken(user._id)
      });
    } else {
      // Failure: Increment attempts
      user.loginAttempts += 1;
      if (user.loginAttempts >= 5) {
        user.lockUntil = Date.now() + 15 * 60 * 1000; // 15 mins lock
      }
      await user.save();

      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};



// @desc    Resend Verification Email
// @route   POST /api/users/resendverification
// @access  Public
const resendVerificationEmail = async (req, res) => {
  const { email } = req.body;
  const crypto = require('crypto');

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: 'User already verified' });
    }

    // Generate new token
    const verificationToken = crypto.randomBytes(20).toString('hex');
    user.verificationToken = verificationToken;
    await user.save();

    // Send Verification Email
    const verifyUrl = `http://localhost:5001/api/users/verifyemail/${verificationToken}`;
    const message = `Please confirm your email by clicking here: \n\n ${verifyUrl}`;

    try {
      const sendEmail = require('../utils/sendEmail');
      await sendEmail({
        email: user.email,
        subject: 'Email Verification',
        message,
      });
      res.status(200).json({ success: true, data: 'Verification email sent' });
    } catch (err) {
      console.error('Verification email failed', err);
      return res.status(500).json({ message: 'Email could not be sent' });
    }

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// @desc    Export User Data (GDPR)
// @route   GET /api/users/export
// @access  Private
const exportUserData = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    let profile = null;

    if (user.role === 'employer' || user.role === 'recruiter') {
      const EmployerProfile = require('../models/EmployerProfile');
      profile = await EmployerProfile.findOne({ user: req.user._id });
    } else {
      const WorkerProfile = require('../models/WorkerProfile');
      profile = await WorkerProfile.findOne({ user: req.user._id });
    }

    res.json({
      user,
      profile,
      exportedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ message: 'Error exporting data' });
  }
};

// @desc    Delete User Account and all associated data
// @route   DELETE /api/users/delete
// @access  Private
const deleteUserAccount = async (req, res) => {
  try {
    const userId = req.user._id;

    // Remove Profiles
    if (req.user.role === 'employer' || req.user.role === 'recruiter') {
      const EmployerProfile = require('../models/EmployerProfile');
      await EmployerProfile.findOneAndDelete({ user: userId });
      // Remove Jobs
      const Job = require('../models/Job');
      await Job.deleteMany({ employerId: userId });
    } else {
      const WorkerProfile = require('../models/WorkerProfile');
      await WorkerProfile.findOneAndDelete({ user: userId });
    }

    // Remove Applications
    const Application = require('../models/Application');
    await Application.deleteMany({ $or: [{ worker: userId }, { employer: userId }] });

    // Remove User
    await User.findByIdAndDelete(userId);

    res.json({ message: 'Account and all associated data deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting account' });
  }
};

// CRUCIAL: This exports the functions so routes can use them
module.exports = { registerUser, authUser, forgotPassword, resetPassword, verifyEmail, resendVerificationEmail, exportUserData, deleteUserAccount };
