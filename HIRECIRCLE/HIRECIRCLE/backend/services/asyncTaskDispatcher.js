const logger = require('../utils/logger');
const { enqueueTask, TASK_TYPES } = require('./distributedTaskQueue');

const dispatchAsyncTask = async ({
    type,
    payload = {},
    fallback = null,
    label = '',
}) => {
    try {
        const queued = await enqueueTask({ type, payload });
        if (queued.accepted) {
            return { queued: true, id: queued.id };
        }
    } catch (error) {
        logger.warn({
            event: 'async_task_enqueue_failed',
            type,
            label,
            message: error.message,
        });
    }

    if (typeof fallback === 'function') {
        try {
            await fallback();
            return { queued: false, fallback: true };
        } catch (error) {
            logger.error({
                event: 'async_task_fallback_failed',
                type,
                label,
                message: error.message,
            });
            return { queued: false, fallback: false };
        }
    }

    return { queued: false, fallback: false };
};

module.exports = {
    TASK_TYPES,
    dispatchAsyncTask,
};
