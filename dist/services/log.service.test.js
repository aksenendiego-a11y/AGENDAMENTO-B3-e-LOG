"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const log_service_1 = require("../services/log.service");
describe('LogService', () => {
    afterEach(async () => {
        await log_service_1.logService.clearLogs();
    });
    test('deve gravar e ler logs', async () => {
        await log_service_1.logService.info('test-source', 'Mensagem de teste', { chave: 'valor' });
        const logs = await log_service_1.logService.getLogs(10);
        expect(logs.length).toBeGreaterThanOrEqual(1);
    });
    test('deve filtrar logs por nível', async () => {
        await log_service_1.logService.error('test-source', 'Erro de teste');
        const logsError = await log_service_1.logService.getLogs(10, 'error');
        expect(logsError.some(log => log.level === 'error')).toBe(true);
    });
    test('deve retornar resumo dos logs', async () => {
        await log_service_1.logService.warn('test-source', 'Aviso de teste');
        const summary = await log_service_1.logService.getLogSummary();
        expect(summary.total).toBeGreaterThanOrEqual(0);
    });
    test('deve limpar logs', async () => {
        await log_service_1.logService.error('test-source', 'Erro para limpar');
        await log_service_1.logService.clearLogs();
        const logs = await log_service_1.logService.getLogs(10);
        expect(logs.length).toBe(0);
    });
});
//# sourceMappingURL=log.service.test.js.map