module.exports = {
    apps: [
        {
            name: 'hire-backend-api',
            script: 'index.js',
            exec_mode: 'cluster',
            instances: 'max',
            max_memory_restart: '512M',
            kill_timeout: 30000,
            listen_timeout: 10000,
            env: {
                NODE_ENV: process.env.NODE_ENV || 'production',
                SHUTDOWN_DRAIN_TIMEOUT_MS: process.env.SHUTDOWN_DRAIN_TIMEOUT_MS || '30000',
                GRACEFUL_SHUTDOWN_TIMEOUT_MS: process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS || '30000',
            },
        },
        {
            name: 'hire-interview-worker',
            script: 'workers/interviewWorker.js',
            exec_mode: 'fork',
            instances: Number.parseInt(process.env.INTERVIEW_WORKER_INSTANCES || '2', 10),
            max_memory_restart: '512M',
            kill_timeout: 30000,
            env: {
                NODE_ENV: process.env.NODE_ENV || 'production',
            },
        },
        {
            name: 'hire-distributed-worker',
            script: 'workers/distributedWorker.js',
            exec_mode: 'fork',
            instances: Number.parseInt(process.env.DISTRIBUTED_WORKER_INSTANCES || '2', 10),
            max_memory_restart: '384M',
            kill_timeout: 30000,
            env: {
                NODE_ENV: process.env.NODE_ENV || 'production',
            },
        },
    ],
};
