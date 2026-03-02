let CloudWatchClient = null;
let PutMetricDataCommand = null;
const logger = require('../utils/logger');

try {
    ({
        CloudWatchClient,
        PutMetricDataCommand,
    } = require('@aws-sdk/client-cloudwatch'));
} catch (error) {
    console.warn('CloudWatch SDK unavailable. Install @aws-sdk/client-cloudwatch for metric publishing.');
}

const namespace = process.env.CLOUDWATCH_NAMESPACE || 'HireCircle/Interview';
const environment = process.env.NODE_ENV || 'development';
const region = process.env.AWS_REGION || process.env.AWS_SQS_REGION || 'ap-south-1';

const cloudwatchClient = CloudWatchClient
    ? new CloudWatchClient({
        region,
        credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            }
            : undefined,
    })
    : null;

const publishMetric = async ({
    metricName,
    value,
    unit = 'Count',
    role = 'system',
    correlationId = 'none',
    dimensions = {},
}) => {
    const numericValue = Number(value);
    if (!metricName || !Number.isFinite(numericValue)) return;

    const dimensionList = [
        { Name: 'Environment', Value: environment },
        { Name: 'Role', Value: String(role || 'system') },
        { Name: 'CorrelationId', Value: String(correlationId || 'none') },
        ...Object.entries(dimensions || {}).map(([name, dimValue]) => ({
            Name: String(name),
            Value: String(dimValue),
        })),
    ];

    if (!cloudwatchClient || !PutMetricDataCommand) {
        logger.info({
            metric: metricName,
            value: numericValue,
            unit,
            role,
            environment,
            correlationId,
            source: 'metric_fallback_log',
        });
        return;
    }

    try {
        const command = new PutMetricDataCommand({
            Namespace: namespace,
            MetricData: [
                {
                    MetricName: metricName,
                    Timestamp: new Date(),
                    Unit: unit,
                    Value: numericValue,
                    Dimensions: dimensionList,
                },
            ],
        });
        await cloudwatchClient.send(command);
    } catch (error) {
        console.warn('CloudWatch metric publish failed:', error.message);
    }
};

module.exports = {
    publishMetric,
};
