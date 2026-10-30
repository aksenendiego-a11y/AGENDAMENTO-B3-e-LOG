export interface LogEntry {
    timestamp: Date;
    level: 'debug' | 'info' | 'warn' | 'error';
    source: string;
    message: string;
    metadata?: any;
    stack?: string;
}
export declare class LogService {
    private logDir;
    private logFile;
    constructor();
    private ensureLogDir;
    writeLog(entry: LogEntry): Promise<void>;
    info(source: string, message: string, metadata?: any): Promise<void>;
    warn(source: string, message: string, metadata?: any): Promise<void>;
    error(source: string, message: string, error?: Error, metadata?: any): Promise<void>;
    debug(source: string, message: string, metadata?: any): Promise<void>;
    getLogs(limit?: number, level?: string): Promise<LogEntry[]>;
    clearLogs(): Promise<void>;
    getLogSummary(): Promise<any>;
}
export declare const logService: LogService;
