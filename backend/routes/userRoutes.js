const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const WorkerProfile = require('../models/WorkerProfile');
// Import all controllers properly
const { registerUser, authUser, forgotPassword, resetPassword, verifyEmail, resendVerificationEmail, exportUserData, deleteUserAccount } = require('../controllers/userController');

/**
 * @swagger
 * /api/users/login:
 *   post:
 *     summary: Authenticate user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: JWT token returned
 *       401:
 *         description: Invalid credentials
 */
router.post('/register', registerUser);
router.post('/login', authUser);
router.post('/forgotpassword', forgotPassword);
router.put('/resetpassword/:resettoken', resetPassword);
router.put('/verifyemail/:verificationtoken', verifyEmail);
router.post('/resendverification', resendVerificationEmail);

router.get('/export', protect, exportUserData);
router.delete('/delete', protect, deleteUserAccount);

// GET /api/users/profile - Fetch logged-in user's profile
router.get('/profile', protect, async (req, res) => {
    try {
        let profile;
        if (req.user.role === 'recruiter' || req.user.role === 'employer') {
            const EmployerProfile = require('../models/EmployerProfile');
            profile = await EmployerProfile.findOne({ user: req.user._id });
        } else {
            profile = await WorkerProfile.findOne({ user: req.user._id });
        }

        if (!profile) {
            // Return empty structure to avoid frontend crashes
            return res.status(200).json({ profile: { roleProfiles: [] } });
        }
        res.json({ profile });
    } catch (error) {
        console.error("GET Profile Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
});

// PUT /api/users/profile - Update logged-in user's profile
router.put('/profile', protect, async (req, res) => {
    try {
        let profile;
        if (req.user.role === 'recruiter' || req.user.role === 'employer') {
            const EmployerProfile = require('../models/EmployerProfile');
            profile = await EmployerProfile.findOneAndUpdate(
                { user: req.user._id },
                { $set: req.body },
                { new: true, upsert: true }
            );

            // Also update the User model's flag if sent
            if (req.body.hasCompletedProfile) {
                const User = require('../models/userModel');
                await User.findByIdAndUpdate(req.user._id, { hasCompletedProfile: true });
            }

        } else {
            profile = await WorkerProfile.findOneAndUpdate(
                { user: req.user._id },
                { $set: req.body },
                { new: true, upsert: true }
            );
        }
        res.json({ profile });
    } catch (error) {
        console.error("PUT Profile Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
});

module.exports = router;
