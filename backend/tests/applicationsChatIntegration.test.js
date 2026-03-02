const Application = require('../models/Application');

describe('applications chat integration', () => {
  it('stores lastMessage preview for apps list chat entry', () => {
    const path = Application.schema.path('lastMessage');
    expect(path).toBeTruthy();
    expect(path.instance).toBe('String');
  });
});
