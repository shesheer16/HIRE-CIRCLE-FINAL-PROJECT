const { buildLocationLabel } = require('../utils/locationFields');
const EmployerProfile = require('../models/EmployerProfile');

const normalizeBrandText = (value) => String(value || '').trim();

const enrichJobsWithEmployerBranding = async (jobs = []) => {
    const rows = Array.isArray(jobs) ? jobs : [];
    if (!rows.length) {
        return rows;
    }

    const employerIds = Array.from(new Set(
        rows
            .map((job) => String(job?.employerId || job?.employer || '').trim())
            .filter(Boolean)
    ));

    if (!employerIds.length) {
        return rows;
    }

    const employerProfiles = await EmployerProfile.find({ user: { $in: employerIds } })
        .select('user companyName industry description location district mandal locationLabel logoUrl website')
        .lean()
        .catch(() => []);

    const profileByEmployerId = new Map(
        employerProfiles.map((profile) => [String(profile?.user || '').trim(), profile])
    );

    return rows.map((job) => {
        const employerId = String(job?.employerId || job?.employer || '').trim();
        const employerProfile = profileByEmployerId.get(employerId);
        if (!employerProfile) {
            return job;
        }

        const logoUrl = normalizeBrandText(
            job?.companyLogoUrl
            || job?.logoUrl
            || employerProfile?.logoUrl
        );
        const companyDescription = normalizeBrandText(
            job?.companyDescription
            || employerProfile?.description
        );
        const companyIndustry = normalizeBrandText(
            job?.companyIndustry
            || employerProfile?.industry
        );
        const companyWebsite = normalizeBrandText(
            job?.companyWebsite
            || employerProfile?.website
        );
        const district = normalizeBrandText(job?.district || employerProfile?.district);
        const mandal = normalizeBrandText(job?.mandal || employerProfile?.mandal);
        const locationLabel = normalizeBrandText(
            job?.locationLabel
            || employerProfile?.locationLabel
            || buildLocationLabel({
                district,
                mandal,
                fallback: employerProfile?.location || job?.location,
            })
        );

        return {
            ...job,
            companyLogoUrl: logoUrl || null,
            logoUrl: logoUrl || null,
            district: district || job?.district || null,
            mandal: mandal || job?.mandal || null,
            locationLabel: locationLabel || job?.locationLabel || job?.location || '',
            companyDescription: companyDescription || '',
            companyIndustry: companyIndustry || '',
            companyWebsite: companyWebsite || '',
            employerProfile: {
                companyName: normalizeBrandText(employerProfile?.companyName) || normalizeBrandText(job?.companyName) || '',
                industry: companyIndustry || '',
                description: companyDescription || '',
                location: locationLabel || normalizeBrandText(employerProfile?.location) || normalizeBrandText(job?.location) || '',
                district: district || '',
                mandal: mandal || '',
                locationLabel: locationLabel || '',
                logoUrl: logoUrl || null,
                website: companyWebsite || '',
            },
        };
    });
};

module.exports = {
    enrichJobsWithEmployerBranding,
};
