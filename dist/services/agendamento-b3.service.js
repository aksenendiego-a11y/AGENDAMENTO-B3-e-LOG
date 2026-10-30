"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.agendamentoService = exports.AgendamentoB3Service = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const constants_1 = require("../config/constants");
class AgendamentoB3Service {
    agendamentos = new Map();
    constructor() {
        logger_1.default.info('AgendamentoB3Service inicializado');
    }
    /**
     * Cria um novo agendamento
     */
    createAgendamento(options) {
        this.validateOptions(options);
        const id = this.generateId();
        const now = new Date();
        const agendamento = {
            id,
            symbol: options.symbol.toUpperCase(),
            date: options.date,
            time: options.time,
            quantity: options.quantity,
            price: options.price,
            status: 'pending',
            createdAt: now,
            updatedAt: now
        };
        this.agendamentos.set(id, agendamento);
        logger_1.default.info(`Agendamento criado: ${id}`, { symbol: options.symbol, date: options.date.toISOString() });
        return agendamento;
    }
    /**
     * Valida as opções do agendamento
     */
    validateOptions(options) {
        if (!options.symbol || options.symbol.length < 2) {
            throw new Error('Símbolo inválido');
        }
        if (options.quantity <= 0) {
            throw new Error('Quantidade deve ser maior que zero');
        }
        if (options.price && options.price <= 0) {
            throw new Error('Preço deve ser maior que zero');
        }
        const validSymbols = Object.keys(constants_1.B3_SYMBOLS);
        if (!validSymbols.includes(options.symbol.toUpperCase())) {
            logger_1.default.warn(`Símbolo ${options.symbol} não está na lista oficial de símbolos`);
        }
    }
    /**
     * Obtém um agendamento pelo ID
     */
    getAgendamento(id) {
        return this.agendamentos.get(id);
    }
    /**
     * Lista todos os agendamentos
     */
    listAgendamentos() {
        return Array.from(this.agendamentos.values());
    }
    /**
     * Atualiza o status de um agendamento
     */
    updateStatus(id, status, executedAt) {
        const agendamento = this.agendamentos.get(id);
        if (!agendamento) {
            return false;
        }
        agendamento.status = status;
        agendamento.updatedAt = new Date();
        if (executedAt) {
            agendamento.executedAt = executedAt;
        }
        logger_1.default.info(`Status atualizado: ${id} -> ${status}`);
        return true;
    }
    /**
     * Cancela um agendamento
     */
    cancelAgendamento(id) {
        const agendamento = this.agendamentos.get(id);
        if (!agendamento || agendamento.status === 'completed' || agendamento.status === 'failed') {
            return false;
        }
        return this.updateStatus(id, 'cancelled');
    }
    /**
     * Verifica se o horário está dentro do horário de negócios da B3
     */
    isHorarioNegocios(date, time) {
        const now = new Date(date);
        const [hours, minutes] = time.split(':').map(Number);
        now.setHours(hours, minutes, 0, 0);
        const dayOfWeek = now.getDay();
        // B3 não opera na segunda-feira (dia 1) e no domingo (dia 0)
        if (dayOfWeek === 0 || dayOfWeek === 1) {
            logger_1.default.warn(`Data ${date.toISOString()} é fim de semana`);
            return false;
        }
        return true;
    }
    /**
     * Gera um ID único
     */
    generateId() {
        return `agr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    /**
     * Limpa agendamentos antigos
     */
    cleanupCompleted() {
        let count = 0;
        for (const [id, agendamento] of this.agendamentos.entries()) {
            if (agendamento.status === 'completed' || agendamento.status === 'cancelled') {
                const age = Date.now() - agendamento.createdAt.getTime();
                if (age > 7 * 24 * 60 * 60 * 1000) { // 7 dias
                    this.agendamentos.delete(id);
                    count++;
                }
            }
        }
        logger_1.default.info(`Limpeza concluída: ${count} agendamentos removidos`);
        return count;
    }
}
exports.AgendamentoB3Service = AgendamentoB3Service;
exports.agendamentoService = new AgendamentoB3Service();
//# sourceMappingURL=agendamento-b3.service.js.map