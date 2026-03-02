const { sanitizeText } = require('../utils/sanitizeText');

describe('my jobs create security', () => {
  it('sanitizes script payloads before persistence fields are used', () => {
    const sanitized = sanitizeText('<script>alert(1)</script> Driver role', { maxLength: 120 });
    expect(sanitized).not.toContain('<script>');
    expect(sanitized).toContain('&lt;script&gt;');
  });
});
