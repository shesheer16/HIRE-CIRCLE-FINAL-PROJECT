const logger = require('./logger');

let installed = false;

const toMessage = (args) => {
    if (!Array.isArray(args) || !args.length) return '';
    if (args.length === 1) return args[0];
    return args;
};

const installConsoleBridge = () => {
    if (installed) return;
    installed = true;

    console.log = (...args) => {
        logger.info({ event: 'console.log', payload: toMessage(args) });
    };

    console.info = (...args) => {
        logger.info({ event: 'console.info', payload: toMessage(args) });
    };

    console.warn = (...args) => {
        logger.warn({ event: 'console.warn', payload: toMessage(args) });
    };

    console.error = (...args) => {
        logger.error({ event: 'console.error', payload: toMessage(args) });
    };
};

module.exports = {
    installConsoleBridge,
};
