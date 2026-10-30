"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const logger_1 = __importDefault(require("./utils/logger"));
async function main() {
    try {
        const app = new app_1.default();
        app.listen();
        // Graceful shutdown
        process.on('SIGINT', async () => {
            logger_1.default.info('Recebido SIGINT, desligando graciosamente...');
            process.exit(0);
        });
        process.on('SIGTERM', async () => {
            logger_1.default.info('Recebido SIGTERM, desligando graciosamente...');
            process.exit(0);
        });
    }
    catch (error) {
        logger_1.default.error('Falha ao iniciar aplicação:', error);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map