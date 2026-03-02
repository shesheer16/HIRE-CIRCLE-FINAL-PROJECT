const { signAccessToken, signRefreshToken } = require('./tokenService');

const generateToken = (id, options = {}) => {
    return signAccessToken(id, options);
};

const generateRefreshToken = (id, options = {}) => {
    return signRefreshToken(id, options);
};

module.exports = { generateToken, generateRefreshToken };
