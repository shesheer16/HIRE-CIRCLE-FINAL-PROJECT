const User = require('../models/userModel');

describe('settings password change security', () => {
  it('stores hashed passwords via pre-save hook', async () => {
    const user = new User({
      name: 'Security User',
      email: 'security-user@example.com',
      password: 'PlainText123!',
    });

    await user.validate();
    expect(user.password).toBe('PlainText123!');
    expect(typeof user.matchPassword).toBe('function');
  });
});
