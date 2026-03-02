const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;',
};

const htmlEscape = (value) => String(value || '').replace(/[&<>"'`]/g, (char) => HTML_ESCAPE_MAP[char] || char);

const sanitizeText = (value, { maxLength = 10000 } = {}) => {
    const escaped = htmlEscape(value);
    const trimmed = escaped.trim();
    if (!Number.isFinite(maxLength) || maxLength <= 0) {
        return trimmed;
    }
    return trimmed.slice(0, maxLength);
};

module.exports = {
    sanitizeText,
    htmlEscape,
};
