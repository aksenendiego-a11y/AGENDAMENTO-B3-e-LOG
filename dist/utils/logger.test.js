"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("./logger"));
describe('Logger', () => {
    test('deve exportar um logger configurado', () => {
        expect(logger_1.default).toBeDefined();
        expect(typeof logger_1.default.info).toBe('function');
        expect(typeof logger_1.default.error).toBe('function');
        expect(typeof logger_1.default.warn).toBe('function');
        expect(typeof logger_1.default.debug).toBe('function');
    });
    test('deve registrar mensagens de info sem erro', () => {
        expect(() => logger_1.default.info('Teste de info')).not.toThrow();
    });
    test('deve registrar mensagens de erro sem erro', () => {
        expect(() => logger_1.default.error('Teste de erro', new Error('Erro de teste'))).not.toThrow();
    });
});
//# sourceMappingURL=logger.test.js.map