"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logService = exports.LogService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const appendFile = (0, util_1.promisify)(fs_1.default.appendFile);
const writeFile = (0, util_1.promisify)(fs_1.default.writeFile);
const mkdir = (0, util_1.promisify)(fs_1.default.mkdir);
class LogService {
    logDir;
    logFile;
    constructor() {
        this.logDir = path_1.default.join(process.cwd(), 'logs');
        this.logFile = path_1.default.join(this.logDir, 'app.log');
        this.ensureLogDir();
    }
    async ensureLogDir() {
        if (!fs_1.default.existsSync(this.logDir)) {
            await mkdir(this.logDir, { recursive: true });
        }
    }
    async writeLog(entry) {
        try {
            const logLine = JSON.stringify(entry) + '\n';
            await appendFile(this.logFile, logLine);
        }
        catch (error) {
            console.error('Falha ao escrever log:', error);
        }
    }
    async info(source, message, metadata) {
        await this.writeLog({
            timestamp: new Date(),
            level: 'info',
            source,
            message,
            metadata,
        });
    }
    async warn(source, message, metadata) {
        await this.writeLog({
            timestamp: new Date(),
            level: 'warn',
            source,
            message,
            metadata,
        });
    }
    async error(source, message, error, metadata) {
        await this.writeLog({
            timestamp: new Date(),
            level: 'error',
            source,
            message,
            metadata,
            stack: error?.stack,
        });
    }
    async debug(source, message, metadata) {
        await this.writeLog({
            timestamp: new Date(),
            level: 'debug',
            source,
            message,
            metadata,
        });
    }
    async getLogs(limit = 100, level) {
        try {
            if (!fs_1.default.existsSync(this.logFile)) {
                return [];
            }
            const content = fs_1.default.readFileSync(this.logFile, 'utf-8');
            const lines = content.trim().split('\n').filter(Boolean);
            let logs = [];
            for (const line of lines) {
                try {
                    const log = JSON.parse(line);
                    log.timestamp = new Date(log.timestamp);
                    logs.push(log);
                }
                catch {
                    // Ignorar linhas corrompidas
                }
            }
            // Filtrar por nível
            if (level) {
                logs = logs.filter(log => log.level === level);
            }
            // Retornar os mais recentes primeiro
            return logs.reverse().slice(0, limit);
        }
        catch (error) {
            console.error('Falha ao ler logs:', error);
            return [];
        }
    }
    async clearLogs() {
        if (fs_1.default.existsSync(this.logFile)) {
            fs_1.default.unlinkSync(this.logFile);
        }
    }
    async getLogSummary() {
        const logs = await this.getLogs(1000);
        const summary = {
            total: logs.length,
            info: logs.filter(l => l.level === 'info').length,
            warn: logs.filter(l => l.level === 'warn').length,
            error: logs.filter(l => l.level === 'error').length,
            debug: logs.filter(l => l.level === 'debug').length,
            oldest: logs[logs.length - 1]?.timestamp || null,
            newest: logs[0]?.timestamp || null,
        };
        return summary;
    }
}
exports.LogService = LogService;
exports.logService = new LogService();
//# sourceMappingURL=log.service.js.map