const { sanitizeText } = require('../utils/sanitizeText');

describe('jobs security penetration', () => {
  it('neutralizes html/script payload in job text fields', () => {
    const sanitized = sanitizeText('<b onclick=alert(1)>Warehouse</b>', { maxLength: 120 });
    expect(sanitized).toContain('&lt;b');
    expect(sanitized).not.toContain('<b');
  });
});
