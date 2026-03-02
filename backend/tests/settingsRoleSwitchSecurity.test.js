const User = require('../models/userModel');

describe('settings role switch security', () => {
  it('blocks non-whitelisted active roles at schema level', () => {
    const user = new User({
      name: 'Role User',
      email: 'role-user@example.com',
      password: 'TestPassword!1',
      activeRole: 'admin',
    });

    const err = user.validateSync();
    expect(err).toBeTruthy();
    expect(err.errors.activeRole).toBeTruthy();
  });
});
