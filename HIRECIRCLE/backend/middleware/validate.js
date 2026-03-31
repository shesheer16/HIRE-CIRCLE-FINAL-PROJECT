const { AppError } = require('./errorMiddleware');

const collectIssues = (result) => {
    return (result.error?.issues || []).map((issue) => ({
        path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path || ''),
        message: issue.message,
        code: issue.code,
    }));
};

const validate = ({ body, query, params } = {}) => {
    return (req, _res, next) => {
        try {
            if (body) {
                const parsedBody = body.safeParse(req.body || {});
                if (!parsedBody.success) {
                    return next(new AppError(400, 'VALIDATION_ERROR', 'Invalid request body', collectIssues(parsedBody), true));
                }
                req.body = parsedBody.data;
            }

            if (query) {
                const parsedQuery = query.safeParse(req.query || {});
                if (!parsedQuery.success) {
                    return next(new AppError(400, 'VALIDATION_ERROR', 'Invalid query parameters', collectIssues(parsedQuery), true));
                }
                req.query = parsedQuery.data;
            }

            if (params) {
                const parsedParams = params.safeParse(req.params || {});
                if (!parsedParams.success) {
                    return next(new AppError(400, 'VALIDATION_ERROR', 'Invalid route parameters', collectIssues(parsedParams), true));
                }
                req.params = parsedParams.data;
            }

            return next();
        } catch (error) {
            return next(new AppError(500, 'VALIDATION_PIPELINE_ERROR', error.message, null, false));
        }
    };
};

module.exports = {
    validate,
};
