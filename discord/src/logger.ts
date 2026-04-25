export function log(message: string, level: 'info' | 'error' = 'info') {
    const logMessage = {
        jsonrpc: '2.0',
        method: 'log',
        params: {
            level,
            message
        }
    };
    process.stdout.write(JSON.stringify(logMessage) + '\n');
}

export function info(message: string) {
    log(message, 'info');
}

export function error(message: string) {
    log(message, 'error');
} 