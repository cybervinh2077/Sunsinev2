const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// Create a write stream for the log file
const logFile = path.join(logsDir, 'bot.log');
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

function getTimestamp() {
    return new Date().toISOString();
}

function formatError(error) {
    if (!error) return 'Unknown error';
    
    let errorInfo = {
        message: error.message || 'No error message',
        stack: error.stack || 'No stack trace',
        name: error.name || 'Unknown error type'
    };

    // Add additional properties if they exist
    if (error.code) errorInfo.code = error.code;
    if (error.status) errorInfo.status = error.status;
    if (error.statusCode) errorInfo.statusCode = error.statusCode;
    
    return errorInfo;
}

function formatLog(level, message, data = null) {
    const timestamp = getTimestamp();
    let logMessage = `[${timestamp}] [${level}] ${message}`;
    
    if (data) {
        if (data instanceof Error) {
            const errorInfo = formatError(data);
            logMessage += `\nError Details:\n${JSON.stringify(errorInfo, null, 2)}`;
        } else if (typeof data === 'object') {
            logMessage += `\nData: ${JSON.stringify(data, null, 2)}`;
        } else {
            logMessage += `\nData: ${data}`;
        }
    }
    
    return logMessage + '\n';
}

const logger = {
    info: (message, data) => {
        const logMessage = formatLog('INFO', message, data);
        logStream.write(logMessage);
        console.log(logMessage);
    },

    error: (message, error) => {
        const logMessage = formatLog('ERROR', message, error);
        logStream.write(logMessage);
        console.error(logMessage);
    },

    warn: (message, data) => {
        const logMessage = formatLog('WARN', message, data);
        logStream.write(logMessage);
        console.warn(logMessage);
    },

    debug: (message, data) => {
        const logMessage = formatLog('DEBUG', message, data);
        logStream.write(logMessage);
        console.debug(logMessage);
    }
};

// Handle process exit
process.on('exit', () => {
    logger.info('Bot shutting down');
    logStream.end();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    // Log additional system information
    logger.error('System Information:', {
        nodeVersion: process.version,
        platform: process.platform,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
    });
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection:', {
        reason: reason instanceof Error ? formatError(reason) : reason,
        promise: promise
    });
});

// Handle process warnings
process.on('warning', (warning) => {
    logger.warn('Process Warning:', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack
    });
});

module.exports = logger; 