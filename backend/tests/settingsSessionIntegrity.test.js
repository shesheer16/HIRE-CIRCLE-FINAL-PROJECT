const { normalizeActiveRole } = require('../utils/userRoleContract');

describe('settings session integrity', () => {
  it('normalizes user role safely for session-bound capability checks', () => {
    expect(normalizeActiveRole('employer')).toBe('employer');
    expect(normalizeActiveRole('ADMIN')).toBe('worker');
  });
});
