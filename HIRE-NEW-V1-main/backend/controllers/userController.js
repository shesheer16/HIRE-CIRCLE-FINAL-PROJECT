const crypto = require('crypto');
const User = require('../models/userModel');
const { generateToken, generateRefreshToken } = require('../utils/generateToken');
const BetaCode = require('../models/BetaCode');
const { triggerWelcomeSeries } = require('../services/marketingService');
const {
  fireAndForget,
  markEmployerSignedUpOnce,
} = require('../services/revenueInstrumentationService');
const { getWorkerLockInSummary } = require('../services/lockInService');
const { ensureReferralForSignup } = require('../services/referralService');
const { computeBadgeForUser } = require('../services/verificationBadgeService');
const { ensureNode, recomputeTrustGraphForUser } = require('../services/trustGraphService');
const { trackFunnelStage } = require('../services/growthFunnelService');
const { normalizeCountryCode, resolveLocaleBundle } = require('../services/geoExpansionService');
const { recordFeatureUsage } = require('../services/monetizationIntelligenceService');
const { safeLogPlatformEvent } = require('../services/eventLoggingService');
const { upsertSubscription } = require('../services/subscriptionService');
const { enqueueBackgroundJob } = require('../services/backgroundQueueService');
const { isRecruiter } = require('../utils/roleGuards');
const { resolveUserRoleContract, applyRoleContractToUser } = require('../utils/userRoleContract');
const { consumeRefreshToken, revokeSession } = require('../utils/tokenService');
const {
  upsertDeviceSession,
  revokeDeviceSession,
  clearSocketSessionsForUser,
} = require('../services/sessionService');
const logger = require('../utils/logger');
const {
  isBrowserSessionRequest,
  readRefreshTokenFromRequest,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
} = require('../utils/webAuthCookies');

const isProductionRuntime = () => String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizePhone = (value) => String(value || '').trim().replace(/[^\d+]/g, '');
const resolveDeviceId = (req = {}) => String(
  req.headers?.['x-device-id']
  || req.body?.deviceId
  || ''
).trim().slice(0, 128);
const resolveDevicePlatform = (req = {}) => String(
  req.headers?.['x-device-platform']
  || req.body?.devicePlatform
  || 'unknown'
).trim().slice(0, 32);
const isStrongPassword = (value) => {
  const password = String(value || '');
  return password.length >= 10
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /[0-9]/.test(password)
    && /[^A-Za-z0-9]/.test(password);
};
const resolveTokenVersion = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const tokenIssuedBeforePasswordChange = (decoded = {}, user = {}) => {
  const issuedAtMs = Number(decoded?.iat || 0) * 1000;
  const changedAtMs = user?.passwordChangedAt ? new Date(user.passwordChangedAt).getTime() : 0;
  if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0) return false;
  if (!Number.isFinite(changedAtMs) || changedAtMs <= 0) return false;
  return issuedAtMs < (changedAtMs - 1000);
};
const requireHttpsUrl = (name, value) => {
  const normalized = String(value || '').trim();
  const resolved = normalized;

  if (!resolved) {
    throw new Error(`${name} is not configured`);
  }
  if (isProductionRuntime() && !resolved.startsWith('https://')) {
    throw new Error(`${name} must use HTTPS in production`);
  }
  return resolved.replace(/\/$/, '');
};
const hashVerificationToken = (token) => crypto
  .createHash('sha256')
  .update(String(token || '').trim())
  .digest('hex');
const issueVerificationToken = () => {
  const rawToken = crypto.randomBytes(20).toString('hex');
  return {
    rawToken,
    hashedToken: hashVerificationToken(rawToken),
  };
};
const buildVerificationUrl = (verificationToken) => {
  const apiPublicUrl = requireHttpsUrl('API_PUBLIC_URL', process.env.API_PUBLIC_URL);
  return `${apiPublicUrl}/api/users/verifyemail/${verificationToken}`;
};
const sendVerificationEmail = async ({ email, verificationToken }) => {
  const sendEmail = require('../utils/sendEmail');
  const verifyUrl = buildVerificationUrl(verificationToken);
  const message = `Please confirm your email by clicking here: \n\n ${verifyUrl}`;

  await sendEmail({
    email,
    subject: 'Email Verification',
    message,
  });
};
const PASSWORD_RECOVERY_RESPONSE = Object.freeze({
  success: true,
  data: 'If an account exists, a password reset link has been sent.',
});
const VERIFICATION_RESEND_RESPONSE = Object.freeze({
  success: true,
  data: 'If an unverified account exists, a verification email has been sent.',
});
const buildAuthPayload = (user, { accessToken, refreshToken, includeRefreshToken = true } = {}) => {
  const roleContract = resolveUserRoleContract(user);
  const payload = {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: roleContract.role,
    roles: roleContract.roles,
    activeRole: roleContract.activeRole,
    primaryRole: roleContract.primaryRole,
    capabilities: roleContract.capabilities,
    hasSelectedRole: true,
    hasCompletedProfile: Boolean(user.hasCompletedProfile),
    isVerified: user.isVerified,
    isAdmin: Boolean(user.isAdmin),
    token: accessToken,
  };

  if (includeRefreshToken) {
    payload.refreshToken = refreshToken;
  }

  return payload;
};

// @desc    Register a new user
// @route   POST /api/users/register
// @access  Public
const registerUser = async (req, res) => {
  const {
    name,
    email,
    phoneNumber,
    password,
    betaCode,
    referredByCode,
    acquisitionSource = 'unknown',
    acquisitionCity = null,
    acquisitionCampaign = null,
    country = 'IN',
    state = null,
    timezone = 'UTC',
    languagePreference = 'en',
  } = req.body;
  const normalizedName = String(name || '').trim();
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phoneNumber);

  try {
    if (!normalizedName) {
      return res.status(400).json({ message: 'Name is required' });
    }

    if (!normalizedEmail) {
      return res.status(400).json({ message: 'Email is required' });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        message: 'Password must be at least 10 characters and include uppercase, lowercase, number, and symbol',
      });
    }

    if (normalizedPhone) {
      const phoneDigits = normalizedPhone.replace(/\D/g, '');
      if (phoneDigits.length < 10 || phoneDigits.length > 15) {
        return res.status(400).json({ message: 'Phone number must be 10 to 15 digits' });
      }
    }

    // Validate beta code only when provided.
    let validCode = null;
    if (betaCode) {
      validCode = await BetaCode.findOne({ code: betaCode.toUpperCase(), isUsed: false });
      if (!validCode) {
        return res.status(400).json({ message: 'Invalid or already used Beta Code' });
      }
    }

    const existingByEmail = await User.findOne({ email: normalizedEmail });
    if (existingByEmail) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    if (normalizedPhone) {
      const existingByPhone = await User.findOne({ phoneNumber: normalizedPhone });
      if (existingByPhone) {
        return res.status(409).json({ message: 'Phone already registered' });
      }
    }

    // Handle Referral logic
    let referredByUserId = null;
    if (referredByCode) {
      const referringUser = await User.findOne({ referralCode: referredByCode.toUpperCase() });
      if (referringUser) {
        referredByUserId = referringUser._id;
      }
    }

    const normalizedCountry = normalizeCountryCode(country);
    const localeBundle = resolveLocaleBundle(normalizedCountry);

    // Generate Verification Token
    const { rawToken: verificationToken, hashedToken: verificationTokenHash } = issueVerificationToken();
    // Generate new unique referral code for this user
    const newReferralCode = crypto.randomBytes(3).toString('hex').toUpperCase() + Date.now().toString().slice(-4);

    const user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      phoneNumber: normalizedPhone || null,
      role: 'candidate',
      roles: ['worker', 'employer'],
      activeRole: 'worker',
      capabilities: {
        canPostJob: false,
        canCreateCommunity: true,
        canCreateBounty: false,
      },
      primaryRole: 'worker',
      hasSelectedRole: true,
      password,
      verificationToken: verificationTokenHash,
      referralCode: newReferralCode,
      referredBy: referredByUserId,
      acquisitionSource,
      acquisitionCity,
      acquisitionCampaign,
      country: normalizedCountry,
      state: String(state || '').trim() || null,
      timezone: String(timezone || 'UTC').trim() || 'UTC',
      languagePreference: String(languagePreference || 'en').trim() || 'en',
      currencyCode: localeBundle.currencyCode,
      languageCode: localeBundle.languageCode,
      globalPreferences: {
        crossBorderMatchEnabled: false,
        displayCurrency: localeBundle.currencyCode,
      },
    });

    if (user) {
      // Send Verification Email
      try {
        await sendVerificationEmail({
          email: user.email,
          verificationToken,
        });
      } catch (err) {
        logger.warn({ event: 'verification_email_failed', message: err?.message || err });
        // We still allow registration, but user is not verified.
      }

      const roleContract = resolveUserRoleContract(user);
      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber || null,
        role: roleContract.role,
        roles: roleContract.roles,
        activeRole: roleContract.activeRole,
        primaryRole: roleContract.primaryRole,
        capabilities: roleContract.capabilities,
        country: user.country,
        state: user.state || null,
        timezone: user.timezone || 'UTC',
        languagePreference: user.languagePreference || 'en',
        currencyCode: user.currencyCode || localeBundle.currencyCode,
        hasSelectedRole: true,
        hasCompletedProfile: Boolean(user.hasCompletedProfile),
        isVerified: Boolean(user.isVerified),
        isAdmin: Boolean(user.isAdmin),
        requiresOtpVerification: true,
        message: 'Account created. Verify OTP to continue.',
      });

      // Trigger automated marketing welcome flow
      triggerWelcomeSeries(user);
      fireAndForget('seedDefaultSubscription', () => upsertSubscription({
        userId: user._id,
        planType: 'free',
        status: 'inactive',
        startDate: new Date(),
        expiryDate: null,
        metadata: {
          source: 'register_user',
        },
      }), { userId: String(user._id) });

      safeLogPlatformEvent({
        type: 'user_signup',
        userId: user._id,
        meta: {
          acquisitionSource,
          acquisitionCity: acquisitionCity || null,
        },
      });
      fireAndForget('queueTrustRecalculationSignup', () => enqueueBackgroundJob({
        type: 'trust_recalculation',
        payload: {
          userId: String(user._id),
          reason: 'signup',
        },
      }), { userId: String(user._id) });

      fireAndForget('trackSignupFunnelStage', () => trackFunnelStage({
        userId: user._id,
        stage: 'signup',
        source: 'register_user',
        metadata: {
          acquisitionSource,
          referredBy: referredByUserId ? String(referredByUserId) : null,
        },
      }), { userId: String(user._id) });

      fireAndForget('trackSignupFeatureUsage', () => recordFeatureUsage({
        userId: user._id,
        featureKey: 'signup',
      }), { userId: String(user._id) });

      fireAndForget('bootstrapTrustGraphNode', () => ensureNode({
        nodeType: 'User',
        externalId: String(user._id),
        ownerUserId: user._id,
        metadata: {
          source: 'signup',
        },
      }), { userId: String(user._id) });

      fireAndForget('computeSignupBadgeTier', () => computeBadgeForUser({
        userId: user._id,
        reason: 'signup',
      }), { userId: String(user._id) });

      fireAndForget('recomputeTrustGraphSignup', () => recomputeTrustGraphForUser({
        userId: user._id,
        reason: 'signup',
      }), { userId: String(user._id) });

      if (referredByUserId) {
        fireAndForget('trackReferralSignup', () => ensureReferralForSignup({
          referrerId: referredByUserId,
          referredUserId: user._id,
          rewardType: 'credit_unlock',
        }), {
          userId: String(user._id),
          referrerId: String(referredByUserId),
        });
      }

      if (isRecruiter(user)) {
        fireAndForget('markEmployerSignedUpOnce', () => markEmployerSignedUpOnce({
          employerId: user._id,
          city: acquisitionCity,
        }), { userId: String(user._id) });
      }

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
    if (error?.code === 11000) {
      if (error?.keyPattern?.email) {
        return res.status(409).json({ message: 'Email already registered' });
      }
      if (error?.keyPattern?.phoneNumber) {
        return res.status(409).json({ message: 'Phone already registered' });
      }
      return res.status(409).json({ message: 'User already exists' });
    }

    if (error?.name === 'ValidationError') {
      const firstValidationMessage = Object.values(error.errors || {})[0]?.message;
      return res.status(400).json({ message: firstValidationMessage || 'Invalid registration payload' });
    }

    logger.error(`Register user error: ${error?.message || error}`);
    return res.status(500).json({
      message: isProductionRuntime()
        ? 'Registration failed. Please try again.'
        : (error?.message || 'Registration failed'),
    });
  }
};

// ... authUser is unchanged ...

// @desc    Verify Email
// @route   PUT /api/users/verifyemail/:verificationtoken
// @access  Public
const verifyEmail = async (req, res) => {
  const verificationToken = String(req.params.verificationtoken || '').trim();
  const hashedVerificationToken = hashVerificationToken(verificationToken);

  try {
    const user = await User.findOne({
      $or: [
        { verificationToken: hashedVerificationToken },
        { verificationToken },
      ],
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or Expired Token' });
    }

    user.isVerified = true;
    user.isEmailVerified = true;
    user.otpVerified = true;
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
  const email = normalizeEmail(req.body?.email);

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(200).json(PASSWORD_RECOVERY_RESPONSE);
    }

    // Get Reset Token
    const resetToken = user.getResetPasswordToken();

    await user.save({ validateBeforeSave: false });

    // Create Reset URL
    const frontendUrl = requireHttpsUrl('FRONTEND_URL', process.env.FRONTEND_URL);
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

    const message = `You are receiving this email because you (or someone else) has requested the reset of a password. Please make a PUT request to: \n\n ${resetUrl}`;

    try {
      const sendEmail = require('../utils/sendEmail');
      await sendEmail({
        email: user.email,
        subject: 'Password Reset Token',
        message,
      });

      return res.status(200).json(PASSWORD_RECOVERY_RESPONSE);
    } catch (err) {
      logger.warn({ event: 'forgot_password_email_failed', message: err?.message || err });
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;

      await user.save({ validateBeforeSave: false });

      return res.status(200).json(PASSWORD_RECOVERY_RESPONSE);
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Reset Password
// @route   PUT /api/users/resetpassword/:resettoken
// @access  Public
const resetPassword = async (req, res) => {
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

    if (!isStrongPassword(req.body?.password)) {
      return res.status(400).json({
        message: 'Password must be at least 10 characters and include uppercase, lowercase, number, and symbol',
      });
    }

    // Set new password
    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    res.status(200).json({
      success: true,
      data: 'Password Reset Success',
      token: generateToken(user._id, { tokenVersion: resolveTokenVersion(user.tokenVersion) }),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};



// @desc    Auth user & get token (LOGIN)
// @route   POST /api/users/login
// @access  Public
const authUser = async (req, res) => {
  const normalizedEmail = normalizeEmail(req.body?.email);
  const password = req.body?.password;
  const deviceId = resolveDeviceId(req);
  const devicePlatform = resolveDevicePlatform(req);

  try {
    if (!normalizedEmail || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await user.matchPassword(password);
    
    if (!isMatch) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= 5) {
        user.lockUntil = Date.now() + 15 * 60 * 1000; // 15 mins lock
      }
      await user.save({ validateBeforeSave: false });
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Password is correct. Now we can safely check account state.
    if (user.isDeleted) {
      return res.status(403).json({ message: 'Account is deleted. Contact support if this is unexpected.' });
    }

    // Check if account is locked
    if (user.lockUntil && user.lockUntil > Date.now()) {
      return res.status(403).json({ message: 'Account locked. Try again later.' });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        message: 'OTP verification required before sign in.',
        requiresOtpVerification: true,
        identity: {
          email: user.email,
          phoneNumber: user.phoneNumber || null,
        },
      });
    }

    // Success: Reset attempts
    applyRoleContractToUser(user);
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    upsertDeviceSession({
      user,
      deviceId,
      platform: devicePlatform,
    });
    await user.save({ validateBeforeSave: false });

    const accessToken = generateToken(user._id, {
      tokenVersion: resolveTokenVersion(user.tokenVersion),
    });
    const refreshToken = generateRefreshToken(user._id, {
      tokenVersion: resolveTokenVersion(user.tokenVersion),
    });

    if (isBrowserSessionRequest(req)) {
      setRefreshTokenCookie(req, res, refreshToken);
    }

    res.json(buildAuthPayload(user, {
      accessToken,
      refreshToken,
      includeRefreshToken: !isBrowserSessionRequest(req),
    }));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Rotate refresh token and issue a new access token pair
// @route   POST /api/users/refresh-token
// @access  Public
const refreshAuthToken = async (req, res) => {
  const refreshToken = readRefreshTokenFromRequest(req);
  const deviceId = resolveDeviceId(req);
  const devicePlatform = resolveDevicePlatform(req);
  if (!refreshToken) {
    return res.status(400).json({ message: 'refreshToken is required' });
  }

  try {
    const decoded = await consumeRefreshToken(refreshToken, 'rotated_refresh_token');
    const user = await User.findById(decoded.id);

    if (!user || user.isDeleted) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }
    const tokenVersion = resolveTokenVersion(decoded?.tv);
    const currentVersion = resolveTokenVersion(user?.tokenVersion);
    if (tokenVersion !== currentVersion) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }
    if (tokenIssuedBeforePasswordChange(decoded, user)) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    if (!user.isVerified) {
      return res.status(403).json({ message: 'Account verification is required before token refresh.' });
    }

    applyRoleContractToUser(user);
    upsertDeviceSession({
      user,
      deviceId,
      platform: devicePlatform,
    });
    await user.save({ validateBeforeSave: false });

    const accessToken = generateToken(user._id, {
      tokenVersion: resolveTokenVersion(user.tokenVersion),
    });
    const nextRefreshToken = generateRefreshToken(user._id, {
      tokenVersion: resolveTokenVersion(user.tokenVersion),
    });

    if (isBrowserSessionRequest(req)) {
      setRefreshTokenCookie(req, res, nextRefreshToken);
    }

    return res.status(200).json(buildAuthPayload(user, {
      accessToken,
      refreshToken: nextRefreshToken,
      includeRefreshToken: !isBrowserSessionRequest(req),
    }));
  } catch (error) {
    logger.security({ event: 'refresh_token_failed', message: error?.message || error });
    if (isBrowserSessionRequest(req)) {
      clearRefreshTokenCookie(req, res);
    }
    return res.status(401).json({ message: 'Invalid refresh token' });
  }
};

// @desc    Logout user by revoking provided access/refresh tokens
// @route   POST /api/users/logout
// @access  Private
const logoutUser = async (req, res) => {
  const header = String(req.headers.authorization || '');
  const accessTokenFromHeader = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : '';
  const accessToken = accessTokenFromHeader || req.authToken || null;
  const refreshToken = readRefreshTokenFromRequest(req) || null;
  const deviceId = resolveDeviceId(req) || null;

  const { revoked } = await revokeSession({
    accessToken,
    refreshToken,
  });

  let revokedDeviceSessions = 0;
  let disconnectedSockets = 0;
  try {
    const user = await User.findById(req.user?._id);
    if (user) {
      revokedDeviceSessions = revokeDeviceSession({
        user,
        deviceId,
      });
      user.tokenVersion = resolveTokenVersion(user.tokenVersion) + 1;
      await user.save({ validateBeforeSave: false });
    }

    const socketResult = await clearSocketSessionsForUser({
      userId: req.user?._id,
      disconnect: true,
    });
    disconnectedSockets = Number(socketResult?.disconnected || 0);
  } catch (sessionError) {
    logger.warn({ event: 'logout_session_cleanup_failed', message: sessionError?.message || sessionError });
  }

  if (isBrowserSessionRequest(req)) {
    clearRefreshTokenCookie(req, res);
  }

  return res.status(200).json({
    success: true,
    message: 'Logged out',
    revokedTokens: revoked,
    revokedDeviceSessions,
    disconnectedSockets,
  });
};



// @desc    Resend Verification Email
// @route   POST /api/users/resendverification
// @access  Public
const resendVerificationEmail = async (req, res) => {
  const email = normalizeEmail(req.body?.email);

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(200).json(VERIFICATION_RESEND_RESPONSE);
    }

    if (user.isVerified) {
      return res.status(200).json(VERIFICATION_RESEND_RESPONSE);
    }

    // Generate new token
    const { rawToken: verificationToken, hashedToken: verificationTokenHash } = issueVerificationToken();
    user.verificationToken = verificationTokenHash;
    await user.save();

    // Send Verification Email
    try {
      await sendVerificationEmail({
        email: user.email,
        verificationToken,
      });
      return res.status(200).json(VERIFICATION_RESEND_RESPONSE);
    } catch (err) {
      logger.warn({ event: 'resend_verification_email_failed', message: err?.message || err });
      return res.status(200).json(VERIFICATION_RESEND_RESPONSE);
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

    if (isRecruiter(user)) {
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
    if (isRecruiter(req.user)) {
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

// @desc    Worker lock-in summary
// @route   GET /api/users/worker-lock-in-summary
// @access  Private
const getWorkerLockInSummaryController = async (req, res) => {
  try {
    if (isRecruiter(req.user)) {
      return res.status(403).json({ message: 'Worker lock-in summary is only available for candidate accounts' });
    }

    const summary = await getWorkerLockInSummary({ userId: req.user._id });
    if (!summary) {
      return res.status(404).json({ message: 'Worker profile not found' });
    }

    return res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    logger.warn({ event: 'worker_lock_in_summary_failed', message: error?.message || error });
    return res.status(500).json({ message: 'Failed to load worker lock-in summary' });
  }
};

// CRUCIAL: This exports the functions so routes can use them
module.exports = {
  registerUser,
  authUser,
  refreshAuthToken,
  logoutUser,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerificationEmail,
  exportUserData,
  deleteUserAccount,
  getWorkerLockInSummaryController,
};
