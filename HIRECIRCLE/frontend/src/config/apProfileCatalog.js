const normalizeToken = (value = '') => String(value || '').trim().toLowerCase();

export const AP_PRIORITY_PROFILE_LOCATIONS = Object.freeze([
    'Madanapalle',
    'Tirupati',
    'Vijayawada',
    'Guntur',
    'Visakhapatnam',
    'Kakinada',
    'Rajahmundry',
    'Nellore',
    'Mohan Babu University',
]);

export const AP_DISTRICT_OPTIONS = Object.freeze([
    'Alluri Sitharama Raju',
    'Anakapalli',
    'Ananthapuramu',
    'Annamayya',
    'Bapatla',
    'Chittoor',
    'Dr. B.R. Ambedkar Konaseema',
    'East Godavari',
    'Eluru',
    'Guntur',
    'Kakinada',
    'Krishna',
    'Kurnool',
    'Markapuram',
    'Nandyal',
    'NTR',
    'Palnadu',
    'Parvathipuram Manyam',
    'Polavaram',
    'Prakasam',
    'Srikakulam',
    'Sri Potti Sriramulu Nellore',
    'Sri Sathya Sai',
    'Tirupati',
    'Visakhapatnam',
    'Vizianagaram',
    'West Godavari',
    'Y.S.R. Kadapa',
    'Mohan Babu University',
]);

export const AP_ALL_PROFILE_LOCATIONS = Object.freeze([
    'Alluri Sitharama Raju',
    'Anakapalli',
    'Ananthapuramu',
    'Annamayya',
    'Bapatla',
    'Chittoor',
    'Dr. B.R. Ambedkar Konaseema',
    'East Godavari',
    'Eluru',
    'Guntur',
    'Kakinada',
    'Krishna',
    'Kurnool',
    'Markapuram',
    'Madanapalle',
    'Nandyal',
    'NTR',
    'Palnadu',
    'Parvathipuram Manyam',
    'Polavaram',
    'Prakasam',
    'Srikakulam',
    'Sri Potti Sriramulu Nellore',
    'Sri Sathya Sai',
    'Tirupati',
    'Visakhapatnam',
    'Vizianagaram',
    'West Godavari',
    'Y.S.R. Kadapa',
    'Vijayawada',
    'Rajahmundry',
    'Ongole',
    'Kadapa',
    'Kadapa',
    'Kurnool',
    'Anantapur',
    'Mohan Babu University',
]);

export const AP_EMPLOYER_LOCATION_OPTIONS = Object.freeze([
    ...AP_ALL_PROFILE_LOCATIONS,
    'Remote / Andhra Pradesh',
    'Remote / Pan India',
]);

export const AP_LANGUAGE_OPTIONS = Object.freeze([
    'Telugu',
    'English',
    'Hindi',
    'Urdu',
    'Tamil',
    'Kannada',
]);

const AP_LOCALITY_HINTS = Object.freeze({
    alluri: ['Araku Valley', 'Paderu', 'Addateegala', 'Anantagiri'],
    'alluri sitharama raju': ['Araku Valley', 'Paderu', 'Addateegala', 'Anantagiri'],
    anakapalli: ['Anakapalli', 'Atchuthapuram', 'Butchayyapeta', 'Cheedikada'],
    ananthapuramu: ['Anantapur', 'Hindupur', 'Bukkapatnam', 'Bathalapalli'],
    anantapur: ['Anantapur', 'Hindupur', 'Bukkapatnam', 'Bathalapalli'],
    annamayya: ['Madanapalle', 'Rayachoti', 'Rajampet', 'Kollabylu'],
    bapatla: ['Bapatla', 'Chirala', 'Amarthalur', 'Bhattiprolu'],
    chittoor: ['Chittoor', 'Bangarupalem', 'Baireddipalle', 'Kuppam'],
    konaseema: ['Amalapuram', 'Ainavilli', 'Allavaram', 'Atreyapuram'],
    'dr. b.r. ambedkar konaseema': ['Amalapuram', 'Ainavilli', 'Allavaram', 'Atreyapuram'],
    'east godavari': ['Rajahmundry', 'Anaparthi', 'Biccavolu', 'Chagallu'],
    eluru: ['Eluru', 'Agiripalli', 'Bheemadole', 'Buttayagudem'],
    guntur: ['Guntur', 'Amaravathi', 'Amarthalur', 'Atchampet'],
    kakinada: ['Kakinada', 'Kakinada Rural', 'Peddapuram', 'Anaparthi'],
    krishna: ['Machilipatnam', 'Avanigadda', 'Bantumilli', 'Challapalli'],
    kurnool: ['Kurnool', 'Adoni', 'Alur', 'Aspari'],
    madanapalle: ['Ankisettipalle', 'Basinikonda', 'Chippili', 'Kollabylu', 'Kothavaripalle', 'Valasapalle'],
    markapuram: ['Markapuram', 'Ardhaveedu', 'Bestavaripeta', 'Chandra Sekhara Puram'],
    nandyal: ['Nandyal', 'Allagadda', 'Atmakur', 'Banaganapalli'],
    ntr: ['Vijayawada', 'Atlapragada Konduru', 'Chandarlapadu'],
    palnadu: ['Narasaraopet', 'Amaravathi', 'Atchampet'],
    'parvathipuram manyam': ['Parvathipuram', 'Balijipeta', 'Bhamini'],
    polavaram: ['Polavaram', 'Addateegala', 'Buttayagudem'],
    prakasam: ['Ongole', 'Addanki', 'Chirala'],
    srikakulam: ['Srikakulam', 'Amadalavalasa', 'Burja'],
    'sri potti sriramulu nellore': ['Nellore', 'Allur', 'Anumasamudrampeta'],
    nellore: ['Nellore', 'Allur', 'Anumasamudrampeta'],
    'sri sathya sai': ['Puttaparthi', 'Hindupur', 'Agali'],
    tirupati: ['Avilala', 'Brahmana Pattu', 'Cherlopalle', 'Tirupati Rural'],
    visakhapatnam: ['Anandapuram', 'Bheemunipatnam', 'Chodavaram', 'Sabbavaram'],
    vizianagaram: ['Bobbili', 'Cheepurupalli', 'Gajapathinagaram'],
    vijayawada: ['Vijayawada', 'Atlapragada Konduru', 'Chandarlapadu'],
    rajahmundry: ['Rajahmundry', 'Anaparthi', 'Biccavolu', 'Chagallu'],
    ongole: ['Ongole', 'Addanki', 'Chirala'],
    kadapa: ['Kadapa', 'Badvel', 'Atlur', 'Chapad'],
    'y.s.r. kadapa': ['Kadapa', 'Badvel', 'Atlur', 'Chapad'],
    'west godavari': ['Bhimavaram', 'Akividu', 'Attili', 'Eluru'],
    'mohan babu university': ['MBU Campus', 'Hostel', 'Academic Block', 'Cafeteria'],
});

const toUniqueList = (entries = []) => [...new Set((Array.isArray(entries) ? entries : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean))];

export const getApPriorityLocations = () => toUniqueList(AP_PRIORITY_PROFILE_LOCATIONS);

export const getApDistrictOptions = () => toUniqueList(AP_DISTRICT_OPTIONS);

export const getApLocationOptions = () => toUniqueList(AP_ALL_PROFILE_LOCATIONS);

export const getApEmployerLocationOptions = () => toUniqueList(AP_EMPLOYER_LOCATION_OPTIONS);

export const getApLanguageOptions = () => toUniqueList(AP_LANGUAGE_OPTIONS);

export const getDefaultApLanguage = (value = '') => {
    const normalized = normalizeToken(value);
    if (!normalized) return 'Telugu';
    if (normalized === 'te' || normalized.startsWith('te-')) return 'Telugu';
    if (normalized === 'en' || normalized.startsWith('en-')) return 'English';
    if (normalized === 'hi' || normalized.startsWith('hi-')) return 'Hindi';
    if (normalized === 'ur' || normalized.startsWith('ur-')) return 'Urdu';
    if (normalized === 'ta' || normalized.startsWith('ta-')) return 'Tamil';
    if (normalized === 'kn' || normalized.startsWith('kn-')) return 'Kannada';
    const matched = AP_LANGUAGE_OPTIONS.find((item) => normalizeToken(item) === normalized);
    return matched || String(value || '').trim() || 'Telugu';
};

export const getApLocalityHints = (location = '') => {
    const normalizedLocation = normalizeToken(location);
    if (!normalizedLocation) return [];

    const match = Object.entries(AP_LOCALITY_HINTS).find(([key]) => (
        normalizedLocation.includes(key)
        || key.includes(normalizedLocation)
    ));

    if (!match) return [];
    return toUniqueList(match[1]);
};
