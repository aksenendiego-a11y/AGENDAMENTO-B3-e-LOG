import logger from './logger';

describe('Logger', () => {
  test('deve exportar um logger configurado', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  test('deve registrar mensagens de info sem erro', () => {
    expect(() => logger.info('Teste de info')).not.toThrow();
  });

  test('deve registrar mensagens de erro sem erro', () => {
    expect(() => logger.error('Teste de erro', new Error('Erro de teste'))).not.toThrow();
  });
});