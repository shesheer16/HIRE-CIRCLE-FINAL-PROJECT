import { AP_LANGUAGE_OPTIONS, AP_PRIORITY_PROFILE_LOCATIONS } from './apProfileCatalog';

const COMMON_CITY_HINTS = [...AP_PRIORITY_PROFILE_LOCATIONS];
const COMMON_LANGUAGE_HINTS = [...AP_LANGUAGE_OPTIONS];

const normalizeToken = (value = '') => String(value || '').trim().toLowerCase();

const makeRole = ({
    title,
    aliases = [],
    skills = [],
    certifications = [],
    suggestedSalary = 0,
    cityHints = COMMON_CITY_HINTS,
    languageHints = COMMON_LANGUAGE_HINTS,
}) => ({
    title,
    aliases,
    skills,
    certifications,
    suggestedSalary,
    cityHints,
    languageHints,
});

const ROLE_GROUPS = Object.freeze([
    {
        label: 'Delivery & Logistics',
        hint: 'Delivery, warehouse, dispatch, fleet, and on-ground gig work',
        algorithmTags: ['DIGITAL_GIG'],
        priority: true,
        roles: [
            makeRole({
                title: 'Delivery Executive',
                aliases: ['Delivery Partner', 'Last Mile Associate'],
                skills: ['Route planning', 'Customer handling', 'Last-mile delivery', 'Cash handling'],
                certifications: ['Two-wheeler license', 'Vehicle safety'],
                suggestedSalary: 22000,
                languageHints: ['Telugu', 'English', 'Hindi'],
            }),
            makeRole({
                title: 'Warehouse Associate',
                aliases: ['Inventory Associate', 'Warehouse Executive'],
                skills: ['Inventory handling', 'Packing and dispatch', 'Scanner usage', 'Warehouse safety'],
                certifications: ['Forklift certification', 'Warehouse safety'],
                suggestedSalary: 21000,
            }),
            makeRole({
                title: 'Picker and Packer',
                aliases: ['Packing Associate', 'Order Picker'],
                skills: ['Picking accuracy', 'Packing', 'Barcode handling', 'Dispatch support'],
                certifications: ['Warehouse safety'],
                suggestedSalary: 19000,
            }),
            makeRole({
                title: 'Dispatch Coordinator',
                aliases: ['Dispatch Associate', 'Fleet Dispatch'],
                skills: ['Dispatch planning', 'Inventory checks', 'Tracker updates', 'Vendor coordination'],
                certifications: ['Basic logistics training'],
                suggestedSalary: 24000,
            }),
            makeRole({
                title: 'Fleet Associate',
                aliases: ['Fleet Executive', 'Field Operations Associate'],
                skills: ['Fleet support', 'Driver coordination', 'Route planning', 'Incident logging'],
                certifications: ['Driving license'],
                suggestedSalary: 25000,
            }),
            makeRole({
                title: 'Driver',
                aliases: ['Commercial Driver', 'Transport Driver'],
                skills: ['Safe driving', 'Route knowledge', 'Vehicle checks', 'Delivery discipline'],
                certifications: ['Driving license', 'Commercial driving license'],
                suggestedSalary: 26000,
                languageHints: ['Telugu', 'Hindi', 'English'],
            }),
        ],
    },
    {
        label: 'Sales & Voice',
        hint: 'Telecalling, field sales, support, promoter, and voice-led roles',
        algorithmTags: ['VOICE', 'DIGITAL_GIG'],
        priority: true,
        roles: [
            makeRole({
                title: 'Sales Executive',
                aliases: ['Field Sales', 'Business Development Executive'],
                skills: ['Lead generation', 'Negotiation', 'Client follow-up', 'CRM tracking'],
                certifications: ['Sales fundamentals'],
                suggestedSalary: 28000,
                languageHints: ['Telugu', 'English', 'Hindi'],
            }),
            makeRole({
                title: 'Field Sales Associate',
                aliases: ['Field Promoter', 'Field Executive'],
                skills: ['Local outreach', 'Lead conversion', 'Daily reporting', 'Relationship building'],
                certifications: ['Field sales training'],
                suggestedSalary: 24000,
                languageHints: ['Telugu', 'English', 'Hindi'],
            }),
            makeRole({
                title: 'Customer Support Executive',
                aliases: ['Support Associate', 'Call Center Executive'],
                skills: ['Ticket handling', 'Communication', 'Issue resolution', 'CRM updates'],
                certifications: ['Customer service training'],
                suggestedSalary: 26000,
                languageHints: ['Telugu', 'English', 'Hindi'],
            }),
            makeRole({
                title: 'Telecaller',
                aliases: ['Caller', 'Outbound Caller', 'Telecalling Executive'],
                skills: ['Call handling', 'Lead follow-up', 'Script discipline', 'Data capture'],
                certifications: ['Voice process training'],
                suggestedSalary: 22000,
                languageHints: ['Telugu', 'English', 'Hindi'],
            }),
            makeRole({
                title: 'Voice Process Associate',
                aliases: ['Voice Support Executive', 'Voice Associate'],
                skills: ['Voice clarity', 'Listening', 'Issue handling', 'SLA follow-through'],
                certifications: ['Voice and accent training'],
                suggestedSalary: 24000,
                languageHints: ['Telugu', 'English', 'Hindi'],
            }),
            makeRole({
                title: 'Promoter',
                aliases: ['Brand Promoter', 'Field Promoter'],
                skills: ['Customer interaction', 'Sampling', 'Lead capture', 'Brand communication'],
                certifications: ['Sales promotion basics'],
                suggestedSalary: 21000,
                languageHints: ['Telugu', 'English'],
            }),
            makeRole({
                title: 'Video Verification Executive',
                aliases: ['Verification Associate', 'KYC Video Associate'],
                skills: ['Video verification', 'Identity checks', 'Documentation', 'Customer interaction'],
                certifications: ['KYC process training'],
                suggestedSalary: 25000,
                languageHints: ['Telugu', 'English', 'Hindi'],
            }),
            makeRole({
                title: 'On-ground Support Associate',
                aliases: ['Field Support Associate', 'Ground Support Executive'],
                skills: ['Issue handling', 'Field coordination', 'Status reporting', 'Customer support'],
                certifications: ['Field operations training'],
                suggestedSalary: 22000,
                languageHints: ['Telugu', 'English', 'Hindi'],
            }),
        ],
    },
    {
        label: 'Agriculture & Rural Work',
        hint: 'Farm, harvest, tractor, sorting, and panchayat-adjacent rural roles',
        algorithmTags: ['AGRICULTURE', 'INFRA'],
        priority: true,
        roles: [
            makeRole({
                title: 'Farm Worker',
                aliases: ['Agriculture Worker', 'Field Worker'],
                skills: ['Farm support', 'Crop handling', 'Manual labour', 'Seasonal work'],
                certifications: ['Basic farm safety'],
                suggestedSalary: 18000,
                languageHints: ['Telugu'],
            }),
            makeRole({
                title: 'Harvest Associate',
                aliases: ['Harvest Worker', 'Crop Harvest Assistant'],
                skills: ['Harvest support', 'Sorting', 'Packing produce', 'Seasonal discipline'],
                certifications: ['Basic farm safety'],
                suggestedSalary: 17000,
                languageHints: ['Telugu'],
            }),
            makeRole({
                title: 'Farm Support Worker',
                aliases: ['Farm Helper', 'Agri Support Worker'],
                skills: ['Irrigation support', 'Crop monitoring', 'Farm cleanup', 'Tool handling'],
                certifications: ['Farm equipment safety'],
                suggestedSalary: 18000,
                languageHints: ['Telugu'],
            }),
            makeRole({
                title: 'Tractor Driver',
                aliases: ['Farm Tractor Operator', 'Tractor Operator'],
                skills: ['Tractor operation', 'Field preparation', 'Equipment upkeep', 'Safety discipline'],
                certifications: ['Driving license', 'Heavy vehicle familiarity'],
                suggestedSalary: 23000,
                languageHints: ['Telugu'],
            }),
            makeRole({
                title: 'Sorting Associate',
                aliases: ['Produce Sorter', 'Agri Sorting Associate'],
                skills: ['Sorting accuracy', 'Grading', 'Packing', 'Quality awareness'],
                certifications: ['Food handling basics'],
                suggestedSalary: 17500,
                languageHints: ['Telugu'],
            }),
            makeRole({
                title: 'Rural Work Assistant',
                aliases: ['Village Work Assistant', 'Local Work Associate'],
                skills: ['Field support', 'Labour work', 'Attendance discipline', 'Material handling'],
                certifications: ['Basic safety'],
                suggestedSalary: 18000,
                languageHints: ['Telugu'],
            }),
        ],
    },
    {
        label: 'Skilled Trades',
        hint: 'Repair, installation, and technical trade roles',
        algorithmTags: [],
        priority: true,
        roles: [
            makeRole({
                title: 'Plumber',
                aliases: ['Pipe Fitter', 'Plumbing Technician'],
                skills: ['Pipe fitting', 'Leak troubleshooting', 'Maintenance checks', 'Tool handling'],
                certifications: ['Trade certification', 'Safety compliance'],
                suggestedSalary: 30000,
            }),
            makeRole({
                title: 'Electrician',
                aliases: ['Electrical Technician', 'Wireman'],
                skills: ['Electrical troubleshooting', 'Wiring standards', 'Circuit diagnosis', 'Preventive maintenance'],
                certifications: ['Electrical license', 'Industrial safety'],
                suggestedSalary: 32000,
            }),
            makeRole({
                title: 'Carpenter',
                aliases: ['Woodwork Technician', 'Furniture Carpenter'],
                skills: ['Wood cutting', 'Measurement accuracy', 'Installation', 'Finishing'],
                certifications: ['Trade certification'],
                suggestedSalary: 28000,
            }),
            makeRole({
                title: 'Welder',
                aliases: ['Fabrication Welder', 'Arc Welder'],
                skills: ['Welding basics', 'Fabrication support', 'Safety protocols', 'Blueprint reading'],
                certifications: ['Welding certification', 'Safety compliance'],
                suggestedSalary: 30000,
            }),
            makeRole({
                title: 'HVAC Technician',
                aliases: ['AC Technician', 'Refrigeration Technician'],
                skills: ['HVAC maintenance', 'Fault diagnosis', 'Installation support', 'Preventive service'],
                certifications: ['HVAC certification', 'Electrical safety'],
                suggestedSalary: 32000,
            }),
        ],
    },
    {
        label: 'Construction & Infra',
        hint: 'Construction support, site work, civil roles, and infra jobs',
        algorithmTags: ['INFRA'],
        priority: true,
        roles: [
            makeRole({
                title: 'Construction Helper',
                aliases: ['Site Helper', 'Construction Labour'],
                skills: ['Material handling', 'Site discipline', 'Basic tools', 'Manual support'],
                certifications: ['Site safety'],
                suggestedSalary: 19000,
                languageHints: ['Telugu'],
            }),
            makeRole({
                title: 'Mason',
                aliases: ['Masonry Worker', 'Civil Mason'],
                skills: ['Brick work', 'Concrete work', 'Measurement', 'Site safety'],
                certifications: ['Trade certification', 'Safety pass'],
                suggestedSalary: 26000,
                languageHints: ['Telugu'],
            }),
            makeRole({
                title: 'Bar Bender',
                aliases: ['Steel Fixer', 'Rebar Worker'],
                skills: ['Steel bending', 'Measurement', 'Drawing follow-through', 'Site safety'],
                certifications: ['Safety pass'],
                suggestedSalary: 24000,
                languageHints: ['Telugu'],
            }),
            makeRole({
                title: 'Civil Technician',
                aliases: ['Site Technician', 'Civil Associate'],
                skills: ['Site checks', 'Drawing support', 'Material planning', 'Reporting'],
                certifications: ['Civil works training'],
                suggestedSalary: 28000,
            }),
            makeRole({
                title: 'Site Supervisor',
                aliases: ['Civil Supervisor', 'Worksite Supervisor'],
                skills: ['Crew coordination', 'Site reporting', 'Material planning', 'Quality checks'],
                certifications: ['Site safety', 'Supervisor training'],
                suggestedSalary: 35000,
            }),
            makeRole({
                title: 'Survey Assistant',
                aliases: ['Survey Helper', 'Field Survey Assistant'],
                skills: ['Field measurement', 'Documentation', 'Equipment setup', 'Reporting'],
                certifications: ['Survey basics'],
                suggestedSalary: 24000,
            }),
        ],
    },
    {
        label: 'Manufacturing & Factory',
        hint: 'Production, assembly, machine, maintenance, and quality roles',
        algorithmTags: [],
        priority: false,
        roles: [
            makeRole({
                title: 'Machine Operator',
                aliases: ['Production Operator', 'Plant Operator'],
                skills: ['Machine handling', 'Quality checks', 'SOP compliance', 'Downtime reporting'],
                certifications: ['Machine safety', 'Quality control'],
                suggestedSalary: 25000,
            }),
            makeRole({
                title: 'Production Associate',
                aliases: ['Production Worker', 'Assembly Associate'],
                skills: ['Line discipline', 'Packing', 'Quality awareness', 'Shift discipline'],
                certifications: ['Factory safety'],
                suggestedSalary: 22000,
            }),
            makeRole({
                title: 'Quality Inspector',
                aliases: ['Quality Checker', 'QA Inspector'],
                skills: ['Inspection', 'Quality checks', 'Documentation', 'Defect reporting'],
                certifications: ['Quality control'],
                suggestedSalary: 26000,
            }),
            makeRole({
                title: 'Assembly Technician',
                aliases: ['Assembly Associate', 'Line Technician'],
                skills: ['Assembly work', 'Tool use', 'Inspection', 'SOP compliance'],
                certifications: ['Assembly safety'],
                suggestedSalary: 23000,
            }),
            makeRole({
                title: 'Maintenance Technician',
                aliases: ['Maintenance Associate', 'Plant Maintenance Technician'],
                skills: ['Preventive maintenance', 'Troubleshooting', 'Safety checks', 'Breakdown handling'],
                certifications: ['Industrial safety'],
                suggestedSalary: 29000,
            }),
            makeRole({
                title: 'Forklift Operator',
                aliases: ['Forklift Driver', 'Material Handler'],
                skills: ['Forklift handling', 'Warehouse movement', 'Safety compliance', 'Stacking'],
                certifications: ['Forklift certification'],
                suggestedSalary: 26000,
            }),
        ],
    },
    {
        label: 'Retail & Hospitality',
        hint: 'Store, food service, customer-facing, and hospitality work',
        algorithmTags: [],
        priority: true,
        roles: [
            makeRole({
                title: 'Retail Associate',
                aliases: ['Store Associate', 'Sales Associate'],
                skills: ['Customer interaction', 'POS billing', 'Stock handling', 'Upselling'],
                certifications: ['Retail operations'],
                suggestedSalary: 20000,
            }),
            makeRole({
                title: 'Cashier',
                aliases: ['POS Cashier', 'Billing Executive'],
                skills: ['POS billing', 'Cash reconciliation', 'Customer support', 'Invoice handling'],
                certifications: ['POS handling'],
                suggestedSalary: 19000,
            }),
            makeRole({
                title: 'Store Supervisor',
                aliases: ['Store Incharge', 'Retail Supervisor'],
                skills: ['Store operations', 'Team coordination', 'Inventory checks', 'Sales tracking'],
                certifications: ['Retail operations'],
                suggestedSalary: 26000,
            }),
            makeRole({
                title: 'Steward',
                aliases: ['Service Associate', 'Dining Steward'],
                skills: ['Guest service', 'Table service', 'Hygiene protocol', 'Coordination'],
                certifications: ['Food handling basics'],
                suggestedSalary: 19000,
            }),
            makeRole({
                title: 'Kitchen Assistant',
                aliases: ['Kitchen Helper', 'Commis Assistant'],
                skills: ['Kitchen prep', 'Food safety', 'Cleaning discipline', 'Service support'],
                certifications: ['Food safety certification'],
                suggestedSalary: 18000,
            }),
            makeRole({
                title: 'Housekeeping Associate',
                aliases: ['Housekeeping Staff', 'Room Attendant'],
                skills: ['Cleaning standards', 'Room setup', 'Inventory support', 'Time management'],
                certifications: ['Hygiene and safety'],
                suggestedSalary: 18000,
            }),
            makeRole({
                title: 'Barista',
                aliases: ['Cafe Associate', 'Coffee Associate'],
                skills: ['Beverage prep', 'Customer interaction', 'POS handling', 'Service etiquette'],
                certifications: ['Food safety certification'],
                suggestedSalary: 20000,
            }),
        ],
    },
    {
        label: 'Support & Back Office',
        hint: 'Operations support, helpdesk, MIS, service, and back-office work',
        algorithmTags: [],
        priority: false,
        roles: [
            makeRole({
                title: 'Data Entry Operator',
                aliases: ['Back Office Executive', 'MIS Executive'],
                skills: ['Data accuracy', 'Excel', 'Documentation', 'Typing speed'],
                certifications: ['Advanced Excel'],
                suggestedSalary: 22000,
            }),
            makeRole({
                title: 'Operations Associate',
                aliases: ['Operations Executive', 'Process Associate'],
                skills: ['Operations support', 'Documentation', 'Follow-through', 'Escalation handling'],
                certifications: ['Operations basics'],
                suggestedSalary: 23000,
            }),
            makeRole({
                title: 'Helpdesk Executive',
                aliases: ['Helpdesk Associate', 'Support Desk Executive'],
                skills: ['Ticket handling', 'Issue logging', 'Coordination', 'SLA follow-up'],
                certifications: ['Helpdesk basics'],
                suggestedSalary: 24000,
            }),
            makeRole({
                title: 'Service Coordinator',
                aliases: ['Service Executive', 'Customer Service Coordinator'],
                skills: ['Scheduling', 'Escalation management', 'Customer updates', 'Documentation'],
                certifications: ['Service operations'],
                suggestedSalary: 25000,
            }),
            makeRole({
                title: 'Office Administrator',
                aliases: ['Admin Executive', 'Office Coordinator'],
                skills: ['Documentation', 'Vendor coordination', 'Calendar management', 'Office operations'],
                certifications: ['Office administration'],
                suggestedSalary: 26000,
            }),
        ],
    },
    {
        label: 'Healthcare & Care',
        hint: 'Patient care, lab, pharmacy, and healthcare support roles',
        algorithmTags: [],
        priority: false,
        roles: [
            makeRole({
                title: 'Nursing Assistant',
                aliases: ['Patient Care Assistant', 'Healthcare Assistant'],
                skills: ['Patient support', 'Vitals assistance', 'Hygiene protocol', 'Record handling'],
                certifications: ['BLS', 'Patient care certification'],
                suggestedSalary: 28000,
            }),
            makeRole({
                title: 'Patient Care Assistant',
                aliases: ['Ward Assistant', 'Care Assistant'],
                skills: ['Patient support', 'Mobility support', 'Observation', 'Record discipline'],
                certifications: ['Patient care certification'],
                suggestedSalary: 25000,
            }),
            makeRole({
                title: 'Pharmacy Assistant',
                aliases: ['Pharmacy Helper', 'Medical Store Assistant'],
                skills: ['Prescription support', 'Inventory handling', 'Billing support', 'Documentation'],
                certifications: ['Pharmacy basics'],
                suggestedSalary: 22000,
            }),
            makeRole({
                title: 'Lab Technician',
                aliases: ['Lab Assistant', 'Pathology Technician'],
                skills: ['Sample handling', 'Reporting discipline', 'Lab safety', 'Documentation'],
                certifications: ['Lab certification'],
                suggestedSalary: 30000,
            }),
            makeRole({
                title: 'Ward Assistant',
                aliases: ['Hospital Assistant', 'Ward Helper'],
                skills: ['Patient movement', 'Cleaning discipline', 'Support work', 'Coordination'],
                certifications: ['Hospital hygiene training'],
                suggestedSalary: 21000,
            }),
        ],
    },
    {
        label: 'Security & Facilities',
        hint: 'Security, CCTV, housekeeping leadership, and facility upkeep',
        algorithmTags: [],
        priority: false,
        roles: [
            makeRole({
                title: 'Security Guard',
                aliases: ['Security Officer', 'Facility Security'],
                skills: ['Access control', 'Incident reporting', 'Patrolling', 'Emergency response'],
                certifications: ['PSARA certification', 'First aid'],
                suggestedSalary: 21000,
            }),
            makeRole({
                title: 'CCTV Operator',
                aliases: ['Surveillance Operator', 'Security Camera Operator'],
                skills: ['CCTV monitoring', 'Incident logging', 'Alert handling', 'Coordination'],
                certifications: ['Security systems training'],
                suggestedSalary: 22000,
            }),
            makeRole({
                title: 'Facility Executive',
                aliases: ['Facility Associate', 'Facility Coordinator'],
                skills: ['Vendor coordination', 'Maintenance tracking', 'Checklist discipline', 'Reporting'],
                certifications: ['Facility operations'],
                suggestedSalary: 24000,
            }),
            makeRole({
                title: 'Housekeeping Supervisor',
                aliases: ['Cleaning Supervisor', 'Facility Housekeeping Lead'],
                skills: ['Team coordination', 'Cleaning standards', 'Inventory checks', 'Shift planning'],
                certifications: ['Housekeeping supervision'],
                suggestedSalary: 23000,
            }),
            makeRole({
                title: 'Maintenance Assistant',
                aliases: ['Maintenance Helper', 'Facility Maintenance Associate'],
                skills: ['Basic repair', 'Checklist discipline', 'Material handling', 'Safety support'],
                certifications: ['Basic safety'],
                suggestedSalary: 20000,
            }),
        ],
    },
    {
        label: 'Technology & Digital',
        hint: 'Engineering, QA, analytics, and digital support roles',
        algorithmTags: ['DIGITAL_GIG'],
        priority: false,
        roles: [
            makeRole({
                title: 'Frontend Developer',
                aliases: ['React Developer', 'UI Developer'],
                skills: ['JavaScript', 'React', 'Responsive UI', 'API integration'],
                certifications: ['Frontend development', 'JavaScript'],
                suggestedSalary: 50000,
                cityHints: [...COMMON_CITY_HINTS, 'Remote'],
                languageHints: ['English', 'Telugu'],
            }),
            makeRole({
                title: 'Backend Developer',
                aliases: ['Node.js Developer', 'Server-side Engineer'],
                skills: ['Node.js', 'REST APIs', 'Database design', 'Debugging'],
                certifications: ['Backend development', 'Cloud fundamentals'],
                suggestedSalary: 55000,
                cityHints: [...COMMON_CITY_HINTS, 'Remote'],
                languageHints: ['English', 'Telugu'],
            }),
            makeRole({
                title: 'QA Engineer',
                aliases: ['Test Engineer', 'Quality Analyst'],
                skills: ['Testing', 'Bug reporting', 'Regression coverage', 'API validation'],
                certifications: ['Software testing'],
                suggestedSalary: 42000,
                cityHints: [...COMMON_CITY_HINTS, 'Remote'],
                languageHints: ['English', 'Telugu'],
            }),
            makeRole({
                title: 'DevOps Engineer',
                aliases: ['Cloud Engineer', 'Platform Engineer'],
                skills: ['CI/CD', 'Cloud basics', 'Monitoring', 'Deployment automation'],
                certifications: ['Cloud fundamentals'],
                suggestedSalary: 60000,
                cityHints: [...COMMON_CITY_HINTS, 'Remote'],
                languageHints: ['English'],
            }),
            makeRole({
                title: 'Support Engineer',
                aliases: ['Technical Support Engineer', 'Application Support Engineer'],
                skills: ['Troubleshooting', 'Ticket handling', 'Logs analysis', 'Customer communication'],
                certifications: ['Support operations'],
                suggestedSalary: 35000,
                cityHints: [...COMMON_CITY_HINTS, 'Remote'],
                languageHints: ['English', 'Telugu'],
            }),
            makeRole({
                title: 'Data Analyst',
                aliases: ['Reporting Analyst', 'MIS Analyst'],
                skills: ['SQL', 'Excel', 'Dashboarding', 'Data validation'],
                certifications: ['Data analysis', 'Advanced Excel'],
                suggestedSalary: 42000,
                cityHints: [...COMMON_CITY_HINTS, 'Remote'],
                languageHints: ['English'],
            }),
        ],
    },
    {
        label: 'Finance & Admin',
        hint: 'Accounts, payroll, HR coordination, and admin roles',
        algorithmTags: [],
        priority: false,
        roles: [
            makeRole({
                title: 'Account Assistant',
                aliases: ['Accounts Executive', 'Finance Assistant'],
                skills: ['Bookkeeping', 'Invoice processing', 'Excel', 'Reconciliation'],
                certifications: ['Tally', 'Basic accounting'],
                suggestedSalary: 26000,
            }),
            makeRole({
                title: 'MIS Executive',
                aliases: ['MIS Analyst', 'Reporting Executive'],
                skills: ['Excel', 'Data validation', 'Report building', 'Accuracy'],
                certifications: ['Advanced Excel'],
                suggestedSalary: 28000,
            }),
            makeRole({
                title: 'HR Coordinator',
                aliases: ['HR Executive', 'Recruitment Coordinator'],
                skills: ['Coordination', 'Interview scheduling', 'Documentation', 'People communication'],
                certifications: ['HR operations'],
                suggestedSalary: 27000,
            }),
            makeRole({
                title: 'Payroll Assistant',
                aliases: ['Payroll Executive', 'Salary Processing Assistant'],
                skills: ['Payroll basics', 'Data checks', 'Excel', 'Confidentiality'],
                certifications: ['Payroll processing'],
                suggestedSalary: 28000,
            }),
        ],
    },
]);

const ROLE_CATALOG = ROLE_GROUPS.flatMap((group) => (
    group.roles.map((role) => ({
        ...role,
        category: group.label,
        groupHint: group.hint,
        algorithmTags: group.algorithmTags,
        priorityGroup: Boolean(group.priority),
    }))
));

const findExactRoleEntry = (roleTitle = '') => {
    const normalizedRole = normalizeToken(roleTitle);
    if (!normalizedRole) return null;

    return ROLE_CATALOG.find((entry) => (
        normalizeToken(entry.title) === normalizedRole
        || (Array.isArray(entry.aliases) && entry.aliases.some((alias) => normalizeToken(alias) === normalizedRole))
    )) || null;
};

const findRoleEntry = (roleTitle = '') => {
    const normalizedRole = normalizeToken(roleTitle);
    if (!normalizedRole) return null;

    const exact = findExactRoleEntry(roleTitle);
    if (exact) return exact;

    const partial = ROLE_CATALOG.find((entry) => (
        normalizeToken(entry.title).includes(normalizedRole)
        || normalizedRole.includes(normalizeToken(entry.title))
        || (Array.isArray(entry.aliases) && entry.aliases.some((alias) => (
            normalizeToken(alias).includes(normalizedRole) || normalizedRole.includes(normalizeToken(alias))
        )))
    ));
    return partial || null;
};

export const searchRoleTitles = (query = '', limit = 10) => {
    const normalizedQuery = normalizeToken(query);
    const searchable = ROLE_CATALOG.map((entry) => ({
        title: entry.title,
        category: entry.category,
        aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
    }));

    if (!normalizedQuery) {
        return searchable.slice(0, limit).map(({ title, category }) => ({ title, category }));
    }

    const startsWith = searchable.filter((entry) => (
        normalizeToken(entry.title).startsWith(normalizedQuery)
        || entry.aliases.some((alias) => normalizeToken(alias).startsWith(normalizedQuery))
    ));
    const contains = searchable.filter((entry) => (
        (normalizeToken(entry.title).includes(normalizedQuery)
            || entry.aliases.some((alias) => normalizeToken(alias).includes(normalizedQuery)))
        && !startsWith.some((item) => item.title === entry.title)
    ));

    return [...startsWith, ...contains]
        .slice(0, limit)
        .map(({ title, category }) => ({ title, category }));
};

export const inferRoleCategory = (roleTitle = '') => {
    const entry = findRoleEntry(roleTitle);
    return String(entry?.category || '').trim();
};

export const hasExactRoleMatch = (roleTitle = '') => Boolean(findExactRoleEntry(roleTitle));

export const getRoleDefaults = (roleTitle = '') => {
    const entry = findExactRoleEntry(roleTitle);
    if (entry) {
        return {
            skills: Array.isArray(entry.skills) ? entry.skills : [],
            certifications: Array.isArray(entry.certifications) ? entry.certifications : [],
            suggestedSalary: Number.isFinite(Number(entry.suggestedSalary)) ? Number(entry.suggestedSalary) : 0,
            cityHints: Array.isArray(entry.cityHints) && entry.cityHints.length ? entry.cityHints : COMMON_CITY_HINTS,
            languageHints: Array.isArray(entry.languageHints) && entry.languageHints.length ? entry.languageHints : COMMON_LANGUAGE_HINTS,
            category: entry.category,
            groupHint: entry.groupHint || '',
            algorithmTags: Array.isArray(entry.algorithmTags) ? entry.algorithmTags : [],
            matchType: 'role',
        };
    }

    return {
        skills: [],
        certifications: [],
        suggestedSalary: 0,
        cityHints: COMMON_CITY_HINTS,
        languageHints: COMMON_LANGUAGE_HINTS,
        category: '',
        groupHint: '',
        algorithmTags: [],
        matchType: 'generic',
    };
};

export const getRoleCategories = () => ROLE_GROUPS.map((group) => ({
    label: group.label,
    hint: group.hint,
    algorithmTags: Array.isArray(group.algorithmTags) ? [...group.algorithmTags] : [],
    priority: Boolean(group.priority),
    roleTitles: group.roles.map((role) => role.title),
}));

export const getPriorityRoleCategories = () => getRoleCategories().filter((group) => group.priority);

export const getRoleTitlesForCategory = (category = '') => {
    const normalizedCategory = normalizeToken(category);
    if (!normalizedCategory) return [];
    const group = ROLE_GROUPS.find((entry) => normalizeToken(entry.label) === normalizedCategory);
    return group ? group.roles.map((role) => role.title) : [];
};

export const getAllRoleTitles = () => ROLE_CATALOG.map((entry) => entry.title);
export const getCommonCityHints = () => [...COMMON_CITY_HINTS];
export const getCommonLanguageHints = () => [...COMMON_LANGUAGE_HINTS];
