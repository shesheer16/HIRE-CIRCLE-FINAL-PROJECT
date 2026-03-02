let SQSClient = null;
let SendMessageCommand = null;
let ReceiveMessageCommand = null;
let DeleteMessageCommand = null;
let GetQueueAttributesCommand = null;

try {
    ({
        SQSClient,
        SendMessageCommand,
        ReceiveMessageCommand,
        DeleteMessageCommand,
        GetQueueAttributesCommand,
    } = require('@aws-sdk/client-sqs'));
} catch (error) {
    console.warn('SQS SDK unavailable. Install @aws-sdk/client-sqs to enable interview queue.');
}

const queueUrl = process.env.AWS_SQS_INTERVIEW_QUEUE_URL || '';
const deadLetterQueueUrl = process.env.AWS_SQS_INTERVIEW_DLQ_URL || '';
const region = process.env.AWS_SQS_REGION || process.env.AWS_REGION || 'ap-south-1';
const depthCacheTtlMs = 10 * 1000;
const maxReceiveCount = Number.parseInt(process.env.INTERVIEW_WORKER_MAX_RECEIVE_COUNT || '5', 10);

let queueDepthCache = {
    value: 0,
    expiresAt: 0,
};

const sqsClient = SQSClient ? new SQSClient({
    region,
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
        : undefined,
}) : null;

const isQueueConfigured = () => Boolean(queueUrl && sqsClient);
const isDeadLetterQueueConfigured = () => Boolean(deadLetterQueueUrl && sqsClient);

const enqueueInterviewJob = async (payload) => {
    if (!isQueueConfigured()) {
        throw new Error('Interview queue is not configured');
    }

    const command = new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(payload),
    });

    const result = await sqsClient.send(command);
    return {
        messageId: result.MessageId,
    };
};

const sendToInterviewDeadLetterQueue = async ({ payload, reason = 'unknown', originalMessage = null }) => {
    if (!isDeadLetterQueueConfigured()) {
        return {
            enqueued: false,
            reason: 'dlq_not_configured',
        };
    }

    const command = new SendMessageCommand({
        QueueUrl: deadLetterQueueUrl,
        MessageBody: JSON.stringify({
            payload,
            reason,
            originalMessageId: originalMessage?.MessageId || null,
            originalReceiveCount: originalMessage?.Attributes?.ApproximateReceiveCount || null,
            failedAt: new Date().toISOString(),
        }),
    });

    const result = await sqsClient.send(command);
    return {
        enqueued: true,
        messageId: result.MessageId,
    };
};

const receiveInterviewMessages = async (maxNumberOfMessages = 5, waitSeconds = 20, visibilityTimeout = 300) => {
    if (!isQueueConfigured()) return [];

    const command = new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: maxNumberOfMessages,
        WaitTimeSeconds: waitSeconds,
        VisibilityTimeout: visibilityTimeout,
        AttributeNames: ['ApproximateReceiveCount'],
    });

    const response = await sqsClient.send(command);
    return response.Messages || [];
};

const deleteInterviewMessage = async (receiptHandle) => {
    if (!isQueueConfigured() || !receiptHandle) return;

    const command = new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
    });

    await sqsClient.send(command);
};

const getInterviewQueueDepth = async () => {
    const now = Date.now();
    if (queueDepthCache.expiresAt > now) {
        return queueDepthCache.value;
    }

    if (!isQueueConfigured()) return 0;

    const command = new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    });

    const response = await sqsClient.send(command);
    const rawVisible = response?.Attributes?.ApproximateNumberOfMessages;
    const rawInflight = response?.Attributes?.ApproximateNumberOfMessagesNotVisible;

    const visible = Number.parseInt(rawVisible || '0', 10) || 0;
    const inflight = Number.parseInt(rawInflight || '0', 10) || 0;
    const depth = visible + inflight;

    queueDepthCache = {
        value: depth,
        expiresAt: now + depthCacheTtlMs,
    };

    return depth;
};

const getQueueSelfRecoveryConfig = () => ({
    maxReceiveCount,
    deadLetterQueueConfigured: isDeadLetterQueueConfigured(),
});

module.exports = {
    enqueueInterviewJob,
    sendToInterviewDeadLetterQueue,
    receiveInterviewMessages,
    deleteInterviewMessage,
    getInterviewQueueDepth,
    getQueueSelfRecoveryConfig,
    isQueueConfigured,
    isDeadLetterQueueConfigured,
};
