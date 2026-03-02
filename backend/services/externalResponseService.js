const successResponse = ({ data = null, meta = {}, requestId = null } = {}) => ({
    success: true,
    requestId,
    data,
    meta,
    timestamp: new Date().toISOString(),
});

const errorResponse = ({ code = 'EXTERNAL_API_ERROR', message = 'External API request failed', details = undefined, requestId = null } = {}) => ({
    success: false,
    requestId,
    error: {
        code,
        message,
        details,
    },
    timestamp: new Date().toISOString(),
});

const sendSuccess = (res, {
    status = 200,
    data = null,
    meta = {},
    requestId = null,
} = {}) => res.status(status).json(successResponse({ data, meta, requestId }));

const sendError = (res, {
    status = 400,
    code,
    message,
    details,
    requestId = null,
} = {}) => res.status(status).json(errorResponse({ code, message, details, requestId }));

module.exports = {
    successResponse,
    errorResponse,
    sendSuccess,
    sendError,
};
