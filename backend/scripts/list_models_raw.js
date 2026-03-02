const https = require('https');
const path = require('path');
const dotenv = require('dotenv');

// Load env from backend root
dotenv.config({ path: path.join(__dirname, '../.env') });

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.warn("Error: GEMINI_API_KEY not found in .env");
    process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

console.log(`Querying: ${url.replace(apiKey, 'HIDDEN_KEY')}`);

https.get(url, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (json.error) {
                console.warn("API Error:", JSON.stringify(json.error, null, 2));
            } else if (json.models) {
                console.log("Available Models:");
                json.models.forEach(m => {
                    if (m.name.includes('gemini')) {
                        console.log(`- ${m.name} (Supported: ${m.supportedGenerationMethods.join(', ')})`);
                    }
                });
            } else {
                console.log("Unexpected response structure:", data);
            }
        } catch (e) {
            console.warn("Parse Error:", e.message);
            console.log("Raw Data:", data);
        }
    });

}).on('error', (err) => {
    console.warn("Network Error:", err.message);
});
