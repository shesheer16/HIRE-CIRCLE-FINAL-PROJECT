const redis = require('redis');

const client = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.on('connect', () => console.log('🔄 Connecting to Redis...'));
client.on('ready', () => console.log('✅ Redis Connected & Ready'));
client.on('error', (err) => console.error('❌ Redis Connection Error:', err));
client.on('reconnecting', () => console.log('⚠️ Redis Reconnecting...'));
client.on('end', () => console.log('🛑 Redis Connection Ended'));

// Connect asynchronously
(async () => {
    try {
        await client.connect();
    } catch (error) {
        console.error('❌ Critical: Redis connection failed. Entering Degradation Mode (Map Cache).');
    }
})();

module.exports = client;
