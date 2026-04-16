const fs = require('fs');
const OpenAI = require('openai');

const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';

const ensureOpenAiClient = () => {
    const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
        const error = new Error('Transcription service unavailable');
        error.statusCode = 503;
        throw error;
    }
    return new OpenAI({ apiKey });
};

const transcribeAudioFile = async (filePath, { mimeType = 'audio/mpeg' } = {}) => {
    if (!filePath || !fs.existsSync(filePath)) {
        const error = new Error('Audio file is missing');
        error.statusCode = 400;
        throw error;
    }

    const client = ensureOpenAiClient();
    const response = await client.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: TRANSCRIBE_MODEL,
        response_format: 'json',
        language: 'en',
    });

    const transcript = String(response?.text || '').trim();
    if (!transcript) {
        const error = new Error('Could not transcribe audio');
        error.statusCode = 422;
        throw error;
    }

    return {
        transcript,
        mimeType,
        model: TRANSCRIBE_MODEL,
    };
};

module.exports = {
    transcribeAudioFile,
};

