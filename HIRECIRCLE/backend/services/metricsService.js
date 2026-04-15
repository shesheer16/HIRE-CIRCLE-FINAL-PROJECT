const logger = require('../utils/logger');

const environment = process.env.NODE_ENV || 'development';

const publishMetric = async ({
    metricName,
    value,
    unit = 'Count',
    role = 'system',
    correlationId = 'none',
    dimensions = {},
} = {}) => {
    const numericValue = Number(value);
    if (!metricName || !Number.isFinite(numericValue)) return;

    logger.info({
        metric: metricName,
        value: numericValue,
        unit,
        role,
        environment,
        correlationId: String(correlationId || 'none'),
        dimensions: dimensions && typeof dimensions === 'object' ? dimensions : {},
        source: 'local_metrics',
    });
};

module.exports = {
    publishMetric,
};
