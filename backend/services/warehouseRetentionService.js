const { archiveRawEventsBefore } = require('./eventEnvelopeService');

const runWarehouseRetentionPolicy = async ({
    now = new Date(),
    rawRetentionDays = Number.parseInt(process.env.WAREHOUSE_RAW_EVENT_RETENTION_DAYS || '90', 10),
    batchSize = Number.parseInt(process.env.WAREHOUSE_ARCHIVE_BATCH_SIZE || '1000', 10),
} = {}) => {
    const cutoffDate = new Date(new Date(now).getTime() - (Math.max(1, Number(rawRetentionDays) || 90) * 24 * 60 * 60 * 1000));
    return archiveRawEventsBefore({
        cutoffDate,
        batchSize,
    });
};

module.exports = {
    runWarehouseRetentionPolicy,
};
