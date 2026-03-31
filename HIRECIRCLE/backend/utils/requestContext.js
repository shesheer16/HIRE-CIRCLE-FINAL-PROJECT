const { AsyncLocalStorage } = require('async_hooks');

const requestContextStorage = new AsyncLocalStorage();

const runWithRequestContext = (context, callback) => {
    requestContextStorage.run(context || {}, callback);
};

const getRequestContext = () => requestContextStorage.getStore() || {};

const getCorrelationId = () => {
    const context = getRequestContext();
    return context.correlationId || null;
};

module.exports = {
    runWithRequestContext,
    getRequestContext,
    getCorrelationId,
};
