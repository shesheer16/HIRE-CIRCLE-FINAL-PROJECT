const crypto = require('crypto');

const maxReceiveCount = Number.parseInt(process.env.INTERVIEW_WORKER_MAX_RECEIVE_COUNT || '5', 10);
const queue = [];
const deadLetterQueue = [];
const inflightByReceipt = new Map();

const nowTs = () => Date.now();

const pruneInflight = () => {
    const now = nowTs();
    for (const [receiptHandle, meta] of inflightByReceipt.entries()) {
        if (!meta || Number(meta.visibilityUntil || 0) <= now) {
            inflightByReceipt.delete(receiptHandle);
        }
    }
};

const isQueueConfigured = () => true;
const isDeadLetterQueueConfigured = () => true;

const enqueueInterviewJob = async (payload) => {
    const messageId = crypto.randomUUID();
    queue.push({
        messageId,
        body: JSON.stringify(payload || {}),
        receiveCount: 0,
    });
    return { messageId };
};

const sendToInterviewDeadLetterQueue = async ({ payload, reason = 'unknown', originalMessage = null } = {}) => {
    const messageId = crypto.randomUUID();
    deadLetterQueue.push({
        messageId,
        payload: payload || null,
        reason,
        originalMessageId: originalMessage?.MessageId || null,
        failedAt: new Date().toISOString(),
    });
    return {
        enqueued: true,
        messageId,
    };
};

const receiveInterviewMessages = async (maxNumberOfMessages = 5, _waitSeconds = 20, visibilityTimeout = 300) => {
    pruneInflight();
    if (!queue.length) return [];

    const now = nowTs();
    const selected = [];
    for (const item of queue) {
        if (selected.length >= Math.max(1, Number(maxNumberOfMessages || 1))) break;

        const alreadyInflight = Array.from(inflightByReceipt.values())
            .some((meta) => String(meta?.messageId || '') === String(item.messageId || ''));
        if (alreadyInflight) continue;

        item.receiveCount = Number(item.receiveCount || 0) + 1;
        const receiptHandle = crypto.randomUUID();
        inflightByReceipt.set(receiptHandle, {
            messageId: item.messageId,
            visibilityUntil: now + (Math.max(1, Number(visibilityTimeout || 300)) * 1000),
        });

        selected.push({
            MessageId: item.messageId,
            Body: item.body,
            ReceiptHandle: receiptHandle,
            Attributes: {
                ApproximateReceiveCount: String(item.receiveCount),
            },
        });
    }

    return selected;
};

const deleteInterviewMessage = async (receiptHandle) => {
    if (!receiptHandle) return;

    const meta = inflightByReceipt.get(receiptHandle);
    if (!meta) return;
    inflightByReceipt.delete(receiptHandle);

    const index = queue.findIndex((item) => String(item.messageId || '') === String(meta.messageId || ''));
    if (index >= 0) {
        queue.splice(index, 1);
    }
};

const getInterviewQueueDepth = async () => {
    pruneInflight();
    return queue.length;
};

const getQueueSelfRecoveryConfig = () => ({
    maxReceiveCount,
    deadLetterQueueConfigured: true,
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
