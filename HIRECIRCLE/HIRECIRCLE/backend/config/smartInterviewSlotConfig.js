const REQUIRED_SLOT_FIELDS = [
    'fullName',
    'city',
    'primaryRole',
    'primarySkills',
    'totalExperienceYears',
    'shiftPreference',
    'expectedSalary',
    'availabilityType',
];

const OPTIONAL_SLOT_FIELDS = [
    'certifications',
    'languages',
    'vehicleOwned',
    'licenseType',
    'preferredWorkRadius',
];

const ALL_SLOT_FIELDS = [...REQUIRED_SLOT_FIELDS, ...OPTIONAL_SLOT_FIELDS];

const SLOT_TYPES = {
    fullName: 'string',
    city: 'string',
    primaryRole: 'string',
    primarySkills: 'string_array',
    totalExperienceYears: 'number',
    shiftPreference: 'enum',
    expectedSalary: 'number',
    availabilityType: 'enum',
    certifications: 'string_array',
    languages: 'string_array',
    vehicleOwned: 'boolean',
    licenseType: 'string',
    preferredWorkRadius: 'number',
};

const SLOT_ENUMS = {
    shiftPreference: ['day', 'night', 'flexible'],
    availabilityType: ['full-time', 'part-time', 'contract'],
};

const FALLBACK_SLOT_QUESTIONS = {
    fullName: 'What is your full name?',
    city: 'Which city are you currently based in?',
    primaryRole: 'What is your primary role?',
    primarySkills: 'What are your top skills for this role?',
    totalExperienceYears: 'How many years of experience do you have?',
    shiftPreference: 'Which shift do you prefer: day, night, or flexible?',
    expectedSalary: 'What is your expected monthly salary in INR?',
    availabilityType: 'Are you looking for full-time, part-time, or contract work?',
    certifications: 'Do you have any certifications to mention?',
    languages: 'Which languages can you work in?',
    vehicleOwned: 'Do you own a vehicle for work?',
    licenseType: 'What license type do you hold?',
    preferredWorkRadius: 'What is your preferred travel radius in kilometers?',
};

const CLARIFICATION_FIELD_MAP = {
    totalExperienceYears: {
        type: 'numeric_selector',
        question: 'How many years of experience do you have?',
        options: ['1', '2', '3', '4+'],
    },
    expectedSalary: {
        type: 'numeric_input',
        question: 'What is your expected monthly salary?',
        currency: 'INR',
    },
    shiftPreference: {
        type: 'single_select',
        question: 'Which shift works best for you?',
        options: ['Day', 'Night', 'Flexible'],
    },
    availabilityType: {
        type: 'single_select',
        question: 'What availability are you looking for?',
        options: ['Full-time', 'Part-time', 'Contract'],
    },
    primarySkills: {
        type: 'multi_select_search',
        question: 'Select your primary skills.',
        options: ['Driving', 'Delivery', 'Warehouse', 'Loading', 'Inventory', 'Dispatch', 'Customer Support'],
    },
    city: {
        type: 'searchable_dropdown',
        question: 'Please confirm your city.',
        options: ['Hyderabad', 'Secunderabad', 'Bengaluru', 'Chennai', 'Mumbai', 'Pune', 'Delhi', 'Noida', 'Gurugram'],
    },
};

module.exports = {
    REQUIRED_SLOT_FIELDS,
    OPTIONAL_SLOT_FIELDS,
    ALL_SLOT_FIELDS,
    SLOT_TYPES,
    SLOT_ENUMS,
    FALLBACK_SLOT_QUESTIONS,
    CLARIFICATION_FIELD_MAP,
};
