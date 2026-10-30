"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.B3_TIMEFRAMES = exports.B3_MARKET_SEGMENTS = exports.B3_OPERATION_TYPES = exports.B3_SYMBOLS = exports.B3_TRADING_HOURS = void 0;
exports.B3_TRADING_HOURS = {
    OPEN: '09:00',
    CLOSE: '17:00',
    TIMEZONE: 'America/Sao_Paulo',
};
exports.B3_SYMBOLS = {
    'WIN$:WIN25': 'WIN',
    'WIN$:WIN26': 'WIN',
    'WIN$:WIN27': 'WIN',
    // Futures mais líquidos da B3
    'WINS25': 'WIN',
    'WINS26': 'WIN',
    'WINS27': 'WIN',
    // Índice de juros DI
    'DI1Y25': 'DI',
    'DI1Y26': 'DI',
    'DI1Y27': 'DI',
};
exports.B3_OPERATION_TYPES = {
    COMPRA: 'BUY',
    VENDA: 'SELL',
    LIMIT: 'LIMIT',
    MARKET: 'MARKET',
    STOP: 'STOP',
};
exports.B3_MARKET_SEGMENTS = {
    RENDA_FIXA: 'RF',
    RENDA_VARIAVEL: 'RV',
    FUTUROS: 'FUT',
    OPCOES: 'OPT',
};
exports.B3_TIMEFRAMES = {
    M1: '1m',
    M5: '5m',
    M15: '15m',
    H1: '1h',
    H4: '4h',
    D1: '1D',
};
//# sourceMappingURL=constants.js.map