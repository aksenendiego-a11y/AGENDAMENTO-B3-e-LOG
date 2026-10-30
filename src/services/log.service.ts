import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const appendFile = promisify(fs.appendFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

export interface LogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
  metadata?: any;
  stack?: string;
}

export class LogService {
  private logDir: string;
  private logFile: string;

  constructor() {
    this.logDir = path.join(process.cwd(), 'logs');
    this.logFile = path.join(this.logDir, 'app.log');
    this.ensureLogDir();
  }

  private async ensureLogDir(): Promise<void> {
    if (!fs.existsSync(this.logDir)) {
      await mkdir(this.logDir, { recursive: true });
    }
  }

  async writeLog(entry: LogEntry): Promise<void> {
    try {
      const logLine = JSON.stringify(entry) + '\n';
      await appendFile(this.logFile, logLine);
    } catch (error) {
      console.error('Falha ao escrever log:', error);
    }
  }

  async info(source: string, message: string, metadata?: any): Promise<void> {
    await this.writeLog({
      timestamp: new Date(),
      level: 'info',
      source,
      message,
      metadata,
    });
  }

  async warn(source: string, message: string, metadata?: any): Promise<void> {
    await this.writeLog({
      timestamp: new Date(),
      level: 'warn',
      source,
      message,
      metadata,
    });
  }

  async error(source: string, message: string, error?: Error, metadata?: any): Promise<void> {
    await this.writeLog({
      timestamp: new Date(),
      level: 'error',
      source,
      message,
      metadata,
      stack: error?.stack,
    });
  }

  async debug(source: string, message: string, metadata?: any): Promise<void> {
    await this.writeLog({
      timestamp: new Date(),
      level: 'debug',
      source,
      message,
      metadata,
    });
  }

  async getLogs(limit: number = 100, level?: string): Promise<LogEntry[]> {
    try {
      if (!fs.existsSync(this.logFile)) {
        return [];
      }

      const content = fs.readFileSync(this.logFile, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      let logs: LogEntry[] = [];

      for (const line of lines) {
        try {
          const log = JSON.parse(line);
          log.timestamp = new Date(log.timestamp);
          logs.push(log);
        } catch {
          // Ignorar linhas corrompidas
        }
      }

      // Filtrar por nível
      if (level) {
        logs = logs.filter(log => log.level === level);
      }

      // Retornar os mais recentes primeiro
      return logs.reverse().slice(0, limit);
    } catch (error) {
      console.error('Falha ao ler logs:', error);
      return [];
    }
  }

  async clearLogs(): Promise<void> {
    if (fs.existsSync(this.logFile)) {
      fs.unlinkSync(this.logFile);
    }
  }

  async getLogSummary(): Promise<any> {
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

export const logService = new LogService();