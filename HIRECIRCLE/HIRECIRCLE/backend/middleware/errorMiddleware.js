const logger = require('../utils/logger');
const { incrementErrorCounter } = require('../services/systemMonitoringService');

class AppError extends Error {
    constructor(statusCode, code, message, details = null, expose = true) {
        super(message);
        this.statusCode = Number(statusCode) || 500;
        this.code = code || 'INTERNAL_ERROR';
        this.details = details;
        this.expose = Boolean(expose);
    }
}

const normalizeError = (error) => {
    if (error instanceof AppError) {
        return error;
    }

    if (error?.name === 'ZodError') {
        return new AppError(400, 'VALIDATION_ERROR', 'Invalid request payload', error.issues, true);
    }

    if (error?.name === 'ValidationError') {
        return new AppError(400, 'VALIDATION_ERROR', 'Invalid request payload', error.errors, true);
    }

    if (error?.name === 'CastError') {
        return new AppError(400, 'INVALID_IDENTIFIER', `Invalid ${error.path || 'id'}`, null, true);
    }

    if (Number(error?.code) === 11000) {
        return new AppError(409, 'DUPLICATE_RESOURCE', 'Duplicate resource', error.keyValue || null, true);
    }

    return new AppError(500, 'INTERNAL_ERROR', error?.message || 'Internal server error', null, false);
};

const notFoundHandler = (req, _res, next) => {
    next(new AppError(404, 'ROUTE_NOT_FOUND', `Route not found: ${req.originalUrl}`, null, true));
};

const errorHandler = (error, req, res, _next) => {
    const normalized = normalizeError(error);
    const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const correlationId = req.correlationId || null;

    const responseMessage = (isProduction && normalized.statusCode >= 500)
        ? 'Internal server error'
        : normalized.message;

    const payload = {
        success: false,
        error: {
            code: normalized.code,
            message: responseMessage,
            details: normalized.details || undefined,
        },
        correlationId,
        timestamp: new Date().toISOString(),
    };

    const exposeStack = String(process.env.EXPOSE_ERROR_STACKS || '').toLowerCase() === 'true';
    if (exposeStack && !isProduction && normalized.stack) {
        payload.error.stack = normalized.stack;
    }

    const logPayload = {
        event: 'request_error',
        correlationId,
        statusCode: normalized.statusCode,
        code: normalized.code,
        message: normalized.message,
        path: req.originalUrl,
        method: req.method,
    };

    if (normalized.statusCode >= 500) {
        logger.error(logPayload);
    } else if (normalized.statusCode === 401 || normalized.statusCode === 403 || normalized.statusCode === 429) {
        logger.security(logPayload);
    } else {
        logger.warn(logPayload);
    }
    void incrementErrorCounter({
        route: req.originalUrl,
        message: normalized.message,
    }).catch(() => {});

    return res.status(normalized.statusCode).json(payload);
};

module.exports = {
    AppError,
    notFoundHandler,
    errorHandler,
};
