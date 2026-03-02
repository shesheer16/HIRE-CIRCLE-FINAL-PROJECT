'use strict';

/**
 * supportCenterService.js
 * 
 * Provides static FAQ structure, smart deflection logic, and ticket generation (Phase 27).
 * Ensures support is manageable and users are deflected to FAQs when possible.
 */

const SupportTicket = require('../models/SupportTicket');

const FAQ_DATABASE = [
    {
        topic: 'account',
        question: 'How do I verify my profile?',
        answer: 'Go to your Profile page and click on the "Verify Now" badge. Follow the instructions to upload your Government ID.',
        keywords: ['verify', 'verification', 'id', 'trust']
    },
    {
        topic: 'payment',
        question: 'When will my escrow payment be released?',
        answer: 'Payments are held securely in Escrow and released after the job is completed and approved by the employer, typically within 24-48 hours.',
        keywords: ['pay', 'payment', 'escrow', 'release', 'money', 'wallet']
    },
    {
        topic: 'job_dispute',
        question: 'What if the employer cancels the job last minute?',
        answer: 'If an employer cancels within 24 hours of the start time, you may be eligible for partial compensation. Please submit a dispute ticket.',
        keywords: ['cancel', 'cancellation', 'dispute', 'employer', 'refund']
    }
];

/**
 * Suggests FAQs based on the user's inquiry text to deflect ticket creation.
 * @param {String} inquiry 
 * @returns {Array} List of matching FAQs
 */
function deflectWithFAQ(inquiry) {
    if (!inquiry) return [];

    const lowercaseInquiry = inquiry.toLowerCase();

    return FAQ_DATABASE.filter(faq => {
        return faq.keywords.some(keyword => lowercaseInquiry.includes(keyword));
    });
}

/**
 * Creates a new support ticket if FAQ deflection fails or is bypassed.
 * @param {String} userId 
 * @param {Object} payload { topic, subject, description, metadata }
 */
async function createSupportTicket(userId, payload) {
    if (!userId) throw new Error('User ID is required');
    if (!payload.subject || !payload.description || !payload.topic) {
        throw new Error('Incomplete ticket payload');
    }

    const ticket = new SupportTicket({
        user: userId,
        topic: payload.topic,
        subject: payload.subject,
        description: payload.description,
        metadata: payload.metadata || {}
    });

    await ticket.save();
    return ticket;
}

/**
 * Retrieves ticket history for a user.
 * @param {String} userId 
 */
async function getUserTickets(userId) {
    return await SupportTicket.find({ user: userId })
        .sort({ createdAt: -1 })
        .lean();
}

module.exports = {
    FAQ_DATABASE,
    deflectWithFAQ,
    createSupportTicket,
    getUserTickets
};
