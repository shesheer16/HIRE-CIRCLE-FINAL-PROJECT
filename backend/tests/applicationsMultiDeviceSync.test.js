const Application = require('../models/Application');

describe('applications multi-device sync', () => {
  it('tracks conversation and status timestamps for cross-device consistency', () => {
    expect(Application.schema.path('statusChangedAt')).toBeTruthy();
    expect(Application.schema.path('lastActivityAt')).toBeTruthy();
    expect(Application.schema.path('conversationLastActiveAt')).toBeTruthy();
  });
});
