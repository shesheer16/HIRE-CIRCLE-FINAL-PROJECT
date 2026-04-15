const Organization = require('../models/Organization');
const User = require('../models/userModel');
const EmployerProfile = require('../models/EmployerProfile');
const logger = require('../utils/logger');

// @desc Create a new Organization (Team Account)
// @route POST /api/organizations
const createOrganization = async (req, res) => {
    try {
        const { name, billingEmail } = req.body;

        const orgExists = await Organization.findOne({ name });
        if (orgExists) {
            return res.status(400).json({ message: "Organization name already taken" });
        }

        const org = await Organization.create({
            name,
            billingEmail,
            subscriptionTier: 'pro' // Defaulting to pro on trial/setup
        });

        // Upgrade requesting user to admin of this org
        const user = await User.findById(req.user._id);
        user.organizationId = org._id;
        user.orgRole = 'admin';
        await user.save();

        res.status(201).json(org);
    } catch (error) {
        console.warn("Create Org Error:", error);
        res.status(500).json({ message: "Failed to create organization" });
    }
};

// @desc Invite member to Organization
// @route POST /api/organizations/invite
const inviteMember = async (req, res) => {
    try {
        const { email, role } = req.body;

        if (req.user.orgRole !== 'admin') {
            return res.status(403).json({ message: "Only organization admins can invite members." });
        }

        const org = await Organization.findById(req.user.organizationId);
        if (!org) {
            return res.status(404).json({ message: "Organization not found" });
        }

        // Check if user exists, if they do attach them, if not trigger an email invite
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            existingUser.organizationId = org._id;
            existingUser.orgRole = role || 'hiring_manager';
            await existingUser.save();
            return res.json({ message: "User attached to organization." });
        } else {
            logger.info({
                event: 'org_invite_email_triggered',
                email: String(email || '').toLowerCase(),
                organizationId: String(org._id),
            });
            return res.json({ message: "Invitation sent to new user." });
        }

    } catch (error) {
        console.warn("Invite Member Error:", error);
        res.status(500).json({ message: "Failed to invite member" });
    }
};

// @desc Initiate SSO Config (stub for Auth0/SAML)
// @route PUT /api/organizations/sso
const configureSSO = async (req, res) => {
    try {
        const { ssoDomain } = req.body;

        if (req.user.orgRole !== 'admin') {
            return res.status(403).json({ message: "Only organization admins can configure SSO." });
        }

        const org = await Organization.findByIdAndUpdate(
            req.user.organizationId,
            { ssoEnabled: true, ssoDomain },
            { new: true }
        );

        res.json({ message: "SSO Configured successfully.", ssoDomain: org.ssoDomain });

    } catch (error) {
        console.warn("Configure SSO Error:", error);
        res.status(500).json({ message: "Failed to configure SSO" });
    }
};

// @desc Get organization details by id (or fallback from employer user id)
// @route GET /api/organizations/:id
const getOrganization = async (req, res) => {
    try {
        const { id } = req.params;

        const org = await Organization.findById(id).lean();
        if (org) {
            return res.json({
                organization: {
                    _id: org._id,
                    name: org.name,
                    industry: org.industry || '',
                    location: org.location || '',
                    website: org.website || '',
                    rating: org.rating || 4.2,
                    employeeCount: org.employeeCount || 0,
                    description: org.description || '',
                },
            });
        }

        const user = await User.findById(id).select('name email').lean();
        if (!user) {
            return res.status(404).json({ message: 'Organization not found' });
        }

        const employerProfile = await EmployerProfile.findOne({ user: user._id }).lean();
        return res.json({
            organization: {
                _id: user._id,
                name: employerProfile?.companyName || user.name,
                industry: employerProfile?.industry || '',
                location: employerProfile?.location || '',
                website: employerProfile?.website || '',
                rating: 4.2,
                employeeCount: 0,
                description: '',
            },
        });
    } catch (error) {
        console.warn("Get Organization Error:", error);
        res.status(500).json({ message: "Failed to load organization details" });
    }
};

module.exports = {
    createOrganization,
    inviteMember,
    configureSSO,
    getOrganization,
};
