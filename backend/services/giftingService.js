'use strict';
/**
 * giftingService.js
 * Feature #77 — User Gifting (Brand Partnerships)
 *
 * Manages branded gift campaigns and user gift redemption.
 * Non-disruptive: additive layer.
 */

const GIFT_TYPES = ['voucher', 'data_pack', 'subscription_trial', 'cashback', 'product'];

/**
 * Build a gift campaign record.
 */
function buildGiftCampaign(partnerId, giftType, value, conditions = {}) {
    if (!GIFT_TYPES.includes(giftType)) {
        throw Object.assign(new Error(`Invalid gift type. Allowed: ${GIFT_TYPES.join(', ')}`), { code: 400 });
    }
    if (!partnerId) throw Object.assign(new Error('partnerId required'), { code: 400 });
    const val = Number(value);
    if (!val || val <= 0) throw Object.assign(new Error('value must be a positive number'), { code: 400 });
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (conditions.durationDays || 30));
    return {
        partnerId: String(partnerId),
        giftType,
        value: val,
        conditions,
        code: `GIFT-${giftType.toUpperCase()}-${Date.now()}`,
        expiresAt,
        createdAt: new Date(),
        active: true,
    };
}

/**
 * Check if a gift campaign is still redeemable.
 */
function isGiftRedeemable(campaign) {
    if (!campaign || !campaign.active) return false;
    return new Date(campaign.expiresAt) > new Date();
}

/**
 * Build a gift redemption record.
 */
function buildRedemptionRecord(userId, campaign) {
    if (!isGiftRedeemable(campaign)) {
        throw Object.assign(new Error('Gift is not redeemable (expired or inactive)'), { code: 400 });
    }
    return {
        userId: String(userId),
        campaignCode: campaign.code,
        giftType: campaign.giftType,
        value: campaign.value,
        redeemedAt: new Date(),
        status: 'redeemed',
    };
}

/**
 * Validate a gift code format.
 */
function validateGiftCode(code) {
    return /^GIFT-[A-Z_]+-\d+$/.test(String(code || ''));
}

module.exports = {
    GIFT_TYPES,
    buildGiftCampaign,
    isGiftRedeemable,
    buildRedemptionRecord,
    validateGiftCode,
};
