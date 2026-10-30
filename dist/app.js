"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const agendamento_b3_service_1 = require("./services/agendamento-b3.service");
const log_service_1 = require("./services/log.service");
const logger_1 = __importDefault(require("./utils/logger"));
const constants_1 = require("./config/constants");
class App {
    app;
    port;
    constructor() {
        this.app = (0, express_1.default)();
        this.port = parseInt(process.env.PORT || '3000');
        this.initializeMiddlewares();
        this.initializeRoutes();
    }
    initializeMiddlewares() {
        this.app.use(express_1.default.json({ limit: '10mb' }));
        this.app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
    }
    initializeRoutes() {
        const router = express_1.default.Router();
        // Health check
        router.get('/health', (req, res) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });
        // Agendamento B3
        router.post('/agendamento/b3', async (req, res) => {
            try {
                const { symbol, date, time, quantity, price, operationType } = req.body;
                if (!symbol || !date || !time || !quantity) {
                    return res.status(400).json({ error: 'Missing required fields' });
                }
                const agendamento = agendamento_b3_service_1.agendamentoService.createAgendamento({
                    symbol,
                    date: new Date(date),
                    time,
                    quantity: parseInt(quantity),
                    price: price ? parseFloat(price) : undefined,
                });
                logger_1.default.info('Agendamento criado via API', { id: agendamento.id, symbol, time });
                return res.status(201).json({
                    id: agendamento.id,
                    status: agendamento.status,
                    symbol: agendamento.symbol,
                    date: agendamento.date,
                    time: agendamento.time,
                    quantity: agendamento.quantity
                });
            }
            catch (error) {
                logger_1.default.error('Falha ao criar agendamento', error);
                return res.status(500).json({ error: error.message });
            }
        });
        router.get('/agendamento/b3', async (req, res) => {
            try {
                const agendamentos = agendamento_b3_service_1.agendamentoService.listAgendamentos();
                return res.json({ agendamentos });
            }
            catch (error) {
                logger_1.default.error('Falha ao listar agendamentos', error);
                return res.status(500).json({ error: error.message });
            }
        });
        router.get('/agendamento/b3/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const agendamento = agendamento_b3_service_1.agendamentoService.getAgendamento(id);
                if (!agendamento) {
                    return res.status(404).json({ error: 'Agendamento não encontrado' });
                }
                return res.json({ agendamento });
            }
            catch (error) {
                logger_1.default.error('Falha ao obter agendamento', error);
                return res.status(500).json({ error: error.message });
            }
        });
        // Status do mercado B3
        router.get('/agendamento/b3/status/mercado', async (req, res) => {
            try {
                const agora = new Date();
                const aberto = this.isHorarioNegociosFunc(agora);
                return res.json({
                    marketOpen: aberto,
                    tradingHours: constants_1.B3_TRADING_HOURS,
                    timezone: constants_1.B3_TRADING_HOURS.TIMEZONE,
                    symbols: Object.keys(constants_1.B3_SYMBOLS).length
                });
            }
            catch (error) {
                logger_1.default.error('Falha ao obter status do mercado', error);
                return res.status(500).json({ error: error.message });
            }
        });
        // Logs
        router.get('/logs', async (req, res) => {
            try {
                const limit = parseInt(req.query.limit || '100');
                const logs = await log_service_1.logService.getLogs(limit);
                return res.json({ logs });
            }
            catch (error) {
                logger_1.default.error('Falha ao obter logs', error);
                return res.status(500).json({ error: error.message });
            }
        });
        router.post('/logs/clear', async (req, res) => {
            try {
                await log_service_1.logService.clearLogs();
                return res.json({ success: true });
            }
            catch (error) {
                logger_1.default.error('Falha ao limpar logs', error);
                return res.status(500).json({ error: error.message });
            }
        });
        router.get('/logs/summary', async (req, res) => {
            try {
                const summary = await log_service_1.logService.getLogSummary();
                return res.json({ summary });
            }
            catch (error) {
                logger_1.default.error('Falha ao obter resumo de logs', error);
                return res.status(500).json({ error: error.message });
            }
        });
        this.app.use('/api', router);
    }
    isHorarioNegociosFunc(date) {
        const hora = date.getHours();
        return hora >= 9 && hora < 17;
    }
    listen() {
        this.app.listen(this.port, () => {
            logger_1.default.info(`SAD System API rodando na porta ${this.port}`);
        });
    }
    getApp() {
        return this.app;
    }
}
exports.default = App;
//# sourceMappingURL=app.js.map