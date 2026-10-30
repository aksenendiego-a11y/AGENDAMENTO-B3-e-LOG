"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const agendamento_b3_service_1 = require("../services/agendamento-b3.service");
describe('AgendamentoB3Service - createAgendamento', () => {
    test('deve criar um agendamento válido', () => {
        const agendamento = agendamento_b3_service_1.agendamentoService.createAgendamento({
            symbol: 'PETR4',
            date: new Date('2025-10-30T10:00:00-03:00'),
            time: '10:00',
            quantity: 100,
        });
        expect(agendamento.id).toBeDefined();
        expect(agendamento.symbol).toBe('PETR4');
        expect(agendamento.quantity).toBe(100);
        expect(agendamento.status).toBe('pending');
        expect(agendamento.createdAt).toBeInstanceOf(Date);
        expect(agendamento.updatedAt).toBeInstanceOf(Date);
    });
    test('deve normalizar o símbolo para maiúsculo', () => {
        const agendamento = agendamento_b3_service_1.agendamentoService.createAgendamento({
            symbol: 'petr4',
            date: new Date('2025-10-30T10:00:00-03:00'),
            time: '10:00',
            quantity: 50,
        });
        expect(agendamento.symbol).toBe('PETR4');
    });
    test('deve lançar erro para símbolo inválido', () => {
        expect(() => {
            agendamento_b3_service_1.agendamentoService.createAgendamento({
                symbol: 'A',
                date: new Date('2025-10-30T10:00:00-03:00'),
                time: '10:00',
                quantity: 100,
            });
        }).toThrow('Símbolo inválido');
    });
    test('deve lançar erro para quantidade zero', () => {
        expect(() => {
            agendamento_b3_service_1.agendamentoService.createAgendamento({
                symbol: 'PETR4',
                date: new Date('2025-10-30T10:00:00-03:00'),
                time: '10:00',
                quantity: 0,
            });
        }).toThrow('Quantidade deve ser maior que zero');
    });
    test('deve lançar erro para preço negativo', () => {
        expect(() => {
            agendamento_b3_service_1.agendamentoService.createAgendamento({
                symbol: 'PETR4',
                date: new Date('2025-10-30T10:00:00-03:00'),
                time: '10:00',
                quantity: 100,
                price: -10,
            });
        }).toThrow('Preço deve ser maior que zero');
    });
});
describe('AgendamentoB3Service - getAgendamento', () => {
    test('deve retornar agendamento pelo ID', () => {
        const criado = agendamento_b3_service_1.agendamentoService.createAgendamento({
            symbol: 'VALE3',
            date: new Date('2025-10-30T10:00:00-03:00'),
            time: '10:00',
            quantity: 200,
        });
        const encontrado = agendamento_b3_service_1.agendamentoService.getAgendamento(criado.id);
        expect(encontrado).toBeDefined();
        expect(encontrado.id).toBe(criado.id);
        expect(encontrado.symbol).toBe('VALE3');
    });
    test('deve retornar undefined para ID inexistente', () => {
        const encontrado = agendamento_b3_service_1.agendamentoService.getAgendamento('id_inexistente');
        expect(encontrado).toBeUndefined();
    });
});
describe('AgendamentoB3Service - listAgendamentos', () => {
    test('deve listar todos os agendamentos criados', () => {
        const inicial = agendamento_b3_service_1.agendamentoService.listAgendamentos().length;
        agendamento_b3_service_1.agendamentoService.createAgendamento({
            symbol: 'ITUB4',
            date: new Date('2025-10-30T10:00:00-03:00'),
            time: '10:00',
            quantity: 300,
        });
        const lista = agendamento_b3_service_1.agendamentoService.listAgendamentos();
        expect(lista.length).toBe(inicial + 1);
    });
});
describe('AgendamentoB3Service - updateStatus', () => {
    test('deve atualizar o status do agendamento', () => {
        const agendamento = agendamento_b3_service_1.agendamentoService.createAgendamento({
            symbol: 'GGBR4',
            date: new Date('2025-10-30T10:00:00-03:00'),
            time: '10:00',
            quantity: 150,
        });
        const resultado = agendamento_b3_service_1.agendamentoService.updateStatus(agendamento.id, 'completed');
        expect(resultado).toBe(true);
        const atualizado = agendamento_b3_service_1.agendamentoService.getAgendamento(agendamento.id);
        expect(atualizado.status).toBe('completed');
    });
    test('deve aceitar executedAt quando fornecido', () => {
        const agendamento = agendamento_b3_service_1.agendamentoService.createAgendamento({
            symbol: 'SUZB3',
            date: new Date('2025-10-30T10:00:00-03:00'),
            time: '10:00',
            quantity: 100,
        });
        const dataExecucao = new Date('2025-10-30T10:05:00-03:00');
        agendamento_b3_service_1.agendamentoService.updateStatus(agendamento.id, 'completed', dataExecucao);
        const atualizado = agendamento_b3_service_1.agendamentoService.getAgendamento(agendamento.id);
        expect(atualizado.executedAt).toEqual(dataExecucao);
    });
});
describe('AgendamentoB3Service - cancelAgendamento', () => {
    test('deve cancelar um agendamento pendente', () => {
        const agendamento = agendamento_b3_service_1.agendamentoService.createAgendamento({
            symbol: 'ABEV3',
            date: new Date('2025-10-30T10:00:00-03:00'),
            time: '10:00',
            quantity: 250,
        });
        const resultado = agendamento_b3_service_1.agendamentoService.cancelAgendamento(agendamento.id);
        expect(resultado).toBe(true);
        const cancelado = agendamento_b3_service_1.agendamentoService.getAgendamento(agendamento.id);
        expect(cancelado.status).toBe('cancelled');
    });
    test('não deve cancelar agendamento já concluído', () => {
        const agendamento = agendamento_b3_service_1.agendamentoService.createAgendamento({
            symbol: 'EQTL3',
            date: new Date('2025-10-30T10:00:00-03:00'),
            time: '10:00',
            quantity: 100,
        });
        agendamento_b3_service_1.agendamentoService.updateStatus(agendamento.id, 'completed');
        const resultado = agendamento_b3_service_1.agendamentoService.cancelAgendamento(agendamento.id);
        expect(resultado).toBe(false);
    });
});
describe('AgendamentoB3Service - isHorarioNegocios', () => {
    test('deve retornar false para domingo', () => {
        const domingo = new Date('2025-10-26T10:00:00-03:00');
        const resultado = agendamento_b3_service_1.agendamentoService.isHorarioNegocios(domingo, '10:00');
        expect(resultado).toBe(false);
    });
    test('deve retornar false para segunda-feira', () => {
        const segunda = new Date('2025-10-27T10:00:00-03:00');
        const resultado = agendamento_b3_service_1.agendamentoService.isHorarioNegocios(segunda, '10:00');
        expect(resultado).toBe(false);
    });
    test('deve retornar true para terça-feira', () => {
        const terca = new Date('2025-10-28T10:00:00-03:00');
        const resultado = agendamento_b3_service_1.agendamentoService.isHorarioNegocios(terca, '10:00');
        expect(resultado).toBe(true);
    });
});
//# sourceMappingURL=agendamento-b3.service.test.js.map