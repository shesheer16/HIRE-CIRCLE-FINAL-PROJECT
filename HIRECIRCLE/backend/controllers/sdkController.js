const path = require('path');

const serveHireSdkV1 = (_req, res) => {
    const sdkPath = path.join(__dirname, '../public-sdk/hire-sdk.v1.js');
    res.set('Cache-Control', 'public, max-age=300');
    return res.sendFile(sdkPath);
};

module.exports = {
    serveHireSdkV1,
};
