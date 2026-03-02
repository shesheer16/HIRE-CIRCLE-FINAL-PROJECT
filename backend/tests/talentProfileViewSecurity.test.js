const { sanitizeText } = require('../utils/sanitizeText');

describe('talent profile view security', () => {
  it('escapes injected markup in talent profile text fields', () => {
    const value = sanitizeText('<img src=x onerror=alert(1)>', { maxLength: 120 });
    expect(value).toContain('&lt;img');
    expect(value).not.toContain('<img');
  });
});
