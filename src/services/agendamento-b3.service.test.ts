import { agendamentoService } from '../services/agendamento-b3.service';

describe('AgendamentoB3Service - createAgendamento', () => {
  test('deve criar um agendamento válido', () => {
    const agendamento = agendamentoService.createAgendamento({
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
    const agendamento = agendamentoService.createAgendamento({
      symbol: 'petr4',
      date: new Date('2025-10-30T10:00:00-03:00'),
      time: '10:00',
      quantity: 50,
    });

    expect(agendamento.symbol).toBe('PETR4');
  });

  test('deve lançar erro para símbolo inválido', () => {
    expect(() => {
      agendamentoService.createAgendamento({
        symbol: 'A',
        date: new Date('2025-10-30T10:00:00-03:00'),
        time: '10:00',
        quantity: 100,
      });
    }).toThrow('Símbolo inválido');
  });

  test('deve lançar erro para quantidade zero', () => {
    expect(() => {
      agendamentoService.createAgendamento({
        symbol: 'PETR4',
        date: new Date('2025-10-30T10:00:00-03:00'),
        time: '10:00',
        quantity: 0,
      });
    }).toThrow('Quantidade deve ser maior que zero');
  });

  test('deve lançar erro para preço negativo', () => {
    expect(() => {
      agendamentoService.createAgendamento({
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
    const criado = agendamentoService.createAgendamento({
      symbol: 'VALE3',
      date: new Date('2025-10-30T10:00:00-03:00'),
      time: '10:00',
      quantity: 200,
    });

    const encontrado = agendamentoService.getAgendamento(criado.id);
    expect(encontrado).toBeDefined();
    expect(encontrado!.id).toBe(criado.id);
    expect(encontrado!.symbol).toBe('VALE3');
  });

  test('deve retornar undefined para ID inexistente', () => {
    const encontrado = agendamentoService.getAgendamento('id_inexistente');
    expect(encontrado).toBeUndefined();
  });
});

describe('AgendamentoB3Service - listAgendamentos', () => {
  test('deve listar todos os agendamentos criados', () => {
    const inicial = agendamentoService.listAgendamentos().length;

    agendamentoService.createAgendamento({
      symbol: 'ITUB4',
      date: new Date('2025-10-30T10:00:00-03:00'),
      time: '10:00',
      quantity: 300,
    });

    const lista = agendamentoService.listAgendamentos();
    expect(lista.length).toBe(inicial + 1);
  });
});

describe('AgendamentoB3Service - updateStatus', () => {
  test('deve atualizar o status do agendamento', () => {
    const agendamento = agendamentoService.createAgendamento({
      symbol: 'GGBR4',
      date: new Date('2025-10-30T10:00:00-03:00'),
      time: '10:00',
      quantity: 150,
    });

    const resultado = agendamentoService.updateStatus(agendamento.id, 'completed');
    expect(resultado).toBe(true);

    const atualizado = agendamentoService.getAgendamento(agendamento.id);
    expect(atualizado!.status).toBe('completed');
  });

  test('deve aceitar executedAt quando fornecido', () => {
    const agendamento = agendamentoService.createAgendamento({
      symbol: 'SUZB3',
      date: new Date('2025-10-30T10:00:00-03:00'),
      time: '10:00',
      quantity: 100,
    });

    const dataExecucao = new Date('2025-10-30T10:05:00-03:00');
    agendamentoService.updateStatus(agendamento.id, 'completed', dataExecucao);

    const atualizado = agendamentoService.getAgendamento(agendamento.id);
    expect(atualizado!.executedAt).toEqual(dataExecucao);
  });
});

describe('AgendamentoB3Service - cancelAgendamento', () => {
  test('deve cancelar um agendamento pendente', () => {
    const agendamento = agendamentoService.createAgendamento({
      symbol: 'ABEV3',
      date: new Date('2025-10-30T10:00:00-03:00'),
      time: '10:00',
      quantity: 250,
    });

    const resultado = agendamentoService.cancelAgendamento(agendamento.id);
    expect(resultado).toBe(true);

    const cancelado = agendamentoService.getAgendamento(agendamento.id);
    expect(cancelado!.status).toBe('cancelled');
  });

  test('não deve cancelar agendamento já concluído', () => {
    const agendamento = agendamentoService.createAgendamento({
      symbol: 'EQTL3',
      date: new Date('2025-10-30T10:00:00-03:00'),
      time: '10:00',
      quantity: 100,
    });

    agendamentoService.updateStatus(agendamento.id, 'completed');
    const resultado = agendamentoService.cancelAgendamento(agendamento.id);
    expect(resultado).toBe(false);
  });
});

describe('AgendamentoB3Service - isHorarioNegocios', () => {
  test('deve retornar false para domingo', () => {
    const domingo = new Date('2025-10-26T10:00:00-03:00');
    const resultado = agendamentoService.isHorarioNegocios(domingo, '10:00');
    expect(resultado).toBe(false);
  });

  test('deve retornar false para segunda-feira', () => {
    const segunda = new Date('2025-10-27T10:00:00-03:00');
    const resultado = agendamentoService.isHorarioNegocios(segunda, '10:00');
    expect(resultado).toBe(false);
  });

  test('deve retornar true para terça-feira', () => {
    const terca = new Date('2025-10-28T10:00:00-03:00');
    const resultado = agendamentoService.isHorarioNegocios(terca, '10:00');
    expect(resultado).toBe(true);
  });
});