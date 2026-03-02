const User = require('../models/userModel');
const logger = require('../utils/logger');

// A/B testing weights for welcome subject line.
const getEmailSubjectId = (userId) => {
    // 50/50 split based on even/odd last char of Mongo ID
    const lastChar = userId.toString().slice(-1);
    return parseInt(lastChar, 16) % 2 === 0 ? 'variant_a' : 'variant_b';
};

const sendEmail = async (user, template, context) => {
    const isProd = process.env.NODE_ENV === 'production';

    // Abstracted Mail Service Logic (SendGrid/AWS SES config would go here)
    if (!isProd) {
        logger.info({
            event: 'dev_mail_preview',
            template,
            email: user.email,
        });
        return true;
    }

    try {
        // e.g., const sgMail = require('@sendgrid/mail');
        // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        // ...
        return true;
    } catch (error) {
        console.warn("Email service error:", error);
        return false;
    }
}

// @desc Trigger Welcome Series onboarding
const triggerWelcomeSeries = async (user) => {
    const variant = getEmailSubjectId(user._id);
    const subject = variant === 'variant_a'
        ? "Welcome to HireApp - Let's get started!"
        : "You're in. Here is how to find your next major opportunity.";

    await sendEmail(user, 'welcome_series_1', { subject, name: user.name });
}

// @desc Automated re-engagement for users inactive > 7 days
const checkInactivityTriggers = async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    try {
        // Find users whose updatedAt is older than 7 days
        const inactiveUsers = await User.find({ updatedAt: { $lt: sevenDaysAgo } });
        logger.info({ event: 'marketing_inactive_users_found', count: inactiveUsers.length });

        for (const user of inactiveUsers) {
            await sendEmail(user, 'we_miss_you', {
                subject: `We haven't seen you in a while, ${user.name}`
            });
            // Update timestamp to avoid spamming everyday
            await User.updateOne({ _id: user._id }, { $set: { updatedAt: new Date() } });
        }
    } catch (e) {
        console.warn("Inactivity Trigger Error:", e);
    }
}

module.exports = {
    triggerWelcomeSeries,
    checkInactivityTriggers,
    sendEmail
};
