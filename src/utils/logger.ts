import path from 'path';
import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true })
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: path.join(__dirname, '..', '..', 'logs', 'app.log') })
  ]
});

export default logger;