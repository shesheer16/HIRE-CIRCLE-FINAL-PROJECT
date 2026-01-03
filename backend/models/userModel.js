const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt fields
  }
);

// This method runs automatically before saving a user to encrypt the password
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    next();
  }

  // Generate a "salt" to make the encryption stronger
  const salt = await bcrypt.genSalt(10);
  // Replace the plain password with the encrypted version
  this.password = await bcrypt.hash(this.password, salt);
});

// This method allows us to compare entered password with the encrypted password in DB
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);

module.exports = User;