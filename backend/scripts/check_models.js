const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
const path = require("path");

// Load .env from backend root
dotenv.config({ path: path.join(__dirname, "../.env") });

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        console.log("Attempting to access gemini-1.5-flash...");
        // Just checking if we can even initialize or if it throws immediately on request
        // But the error happens on generateContent usually.
        // Let's use the model listing API if available, but the SDK simplifies this.
        // Actually, the SDK doesn't expose listModels directly on the main class easily in all versions.
        // Let's try a direct fetch if SDK doesn't help, or just try to generate with a known stable model.
        return;
    } catch (e) {
        console.warn(e);
    }
}

// Better approach: Use the API to list models if possible, or just try a fallback.
// Since the user is stuck, let's just try to fix it by switching to a known stable alias.
// `gemini-1.5-flash` might be `gemini-1.5-flash-001`
console.log("Checking API Key availability...");
if (!process.env.GEMINI_API_KEY) {
    console.warn("NO API KEY FOUND");
} else {
    console.log("API Key present (starts with):", process.env.GEMINI_API_KEY.substring(0, 5));
}
