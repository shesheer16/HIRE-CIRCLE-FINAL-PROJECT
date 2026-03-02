const Application = require('../models/Application');

describe('talent chat integration', () => {
  it('tracks conversation activity fields on applications', () => {
    expect(Application.schema.path('conversationLastActiveAt')).toBeTruthy();
    expect(Application.schema.path('lastMessage')).toBeTruthy();
  });
});
