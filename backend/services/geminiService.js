const axios = require('axios');
const fs = require('fs');

const extractWorkerDataFromAudio = async (audioPath, userRole = 'worker') => {
    const apiKey = process.env.GEMINI_API_KEY;
    console.log("API Key Check:", apiKey ? "Key Found" : "Key MISSING");
    // Switching to 'gemini-flash-latest' which was explicitly listed in the available models
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;

    try {
        const audioBase64 = fs.readFileSync(audioPath).toString("base64");

        const extractionPrompt = `
You are extracting structured hiring data from a voice transcript.
The speaker is a ${userRole === 'worker' ? 'job seeker describing themselves' : 'employer describing a job opening'}.

Extract and return ONLY valid JSON with these exact fields:
${userRole === 'worker' ? `
{
  "name": "full name if mentioned, else null",
  "roleTitle": "job title or role they do",
  "skills": ["skill1", "skill2"],
  "experienceYears": number or null,
  "expectedSalary": "salary expectation as string",
  "preferredShift": "day/night/flexible/any",
  "location": "city or area if mentioned",
  "summary": "2-3 sentence professional summary based on what they said"
}` : `
{
  "jobTitle": "the job title needed",
  "companyName": "company name if mentioned",
  "requiredSkills": ["skill1", "skill2"],
  "experienceRequired": "experience requirement as string",
  "salaryRange": "salary range offered",
  "shift": "day/night/flexible/any",
  "location": "job location",
  "description": "2-3 sentence job description"
}`}

Rules:
- Return ONLY the JSON object, no extra text.
- If something is not mentioned, use null.
- Normalize shorthand skill names to standard names.
`;

        const payload = {
            contents: [{
                parts: [
                    { text: extractionPrompt },
                    {
                        inlineData: {
                            mimeType: "audio/mp3",
                            data: audioBase64
                        }
                    }
                ]
            }]
        };

        const response = await axios.post(url, payload);
        // Handle potential differences in response structure, but typically it's candidates[0].content.parts[0].text
        if (response.data.candidates && response.data.candidates.length > 0) {
            let resultText = response.data.candidates[0].content.parts[0].text || '';
            resultText = resultText.replace(/```json/gi, '').replace(/```/g, '').trim();

            const startIdx = resultText.indexOf('{');
            const endIdx = resultText.lastIndexOf('}');

            if (startIdx !== -1 && endIdx !== -1) {
                const jsonString = resultText.substring(startIdx, endIdx + 1);
                return JSON.parse(jsonString);
            }

            return JSON.parse(resultText);
        } else {
            throw new Error("No candidates returned from Gemini API");
        }
    } catch (error) {
        console.error("Manual Gemini API Error:", error.response?.data || error.message);
        throw new Error("AI Processing failed at the network level.");
    }
};

const explainMatch = async (jobData, candidateData, score) => {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;

    const promptText = `
Given this job: ${jobData.title}, Requirements: ${jobData.requirements.join(', ')}
And this candidate: Skills: ${candidateData.skills.join(', ')}, Experience: ${candidateData.experience}, Location: ${candidateData.location}
The match score is ${score}%.
Provide 3 concise bullet points explaining why this candidate is a good fit.
Format as JSON array of strings. Do not include markdown formatting like \`\`\`json.
    `;

    try {
        const payload = { contents: [{ parts: [{ text: promptText }] }] };
        const response = await axios.post(url, payload);

        if (response.data.candidates && response.data.candidates.length > 0) {
            let resultText = response.data.candidates[0].content.parts[0].text;
            resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
            const startIdx = resultText.indexOf('[');
            const endIdx = resultText.lastIndexOf(']');
            if (startIdx !== -1 && endIdx !== -1) {
                return JSON.parse(resultText.substring(startIdx, endIdx + 1));
            }
            return JSON.parse(resultText);
        }
        return ["Strong overall profile alignment", "Relevant technical skills", "Experience meets requirements"];
    } catch (error) {
        console.error("Gemini Explain Error:", error.message);
        return [
            "Matches key role requirements",
            "Has verifiable experience locally",
            "Fits salary and logistical constrains"
        ]; // Fallback
    }
};

module.exports = { extractWorkerDataFromAudio, explainMatch };
