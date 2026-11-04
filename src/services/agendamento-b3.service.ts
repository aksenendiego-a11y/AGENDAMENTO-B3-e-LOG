import logger from '../utils/logger';
import { B3_SYMBOLS, B3_TRADING_HOURS } from '../config/constants';

export interface AgendamentoAttachment {
  agendamentoId: string;
  filename: string;
  url: string;
  type: 'note' | 'xml';
  size?: number;
  downloadedAt?: Date;
}

export interface AgendamentoOptions {
  symbol: string;
  date: Date;
  time: string;
  quantity: number;
  price?: number;
}

export interface AgendamentoStatus {
  id: string;
  symbol: string;
  date: Date;
  time: string;
  quantity: number;
  price?: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
  executedAt?: Date;
}

export class AgendamentoB3Service {
  private agendamentos: Map<string, AgendamentoStatus> = new Map();
  private attachments: Map<string, AgendamentoAttachment[]> = new Map();

  constructor() {
    logger.info('AgendamentoB3Service inicializado');
  }

  /**
   * Cria um novo agendamento
   */
  public createAgendamento(options: AgendamentoOptions): AgendamentoStatus {
    this.validateOptions(options);
    
    const id = this.generateId();
    const now = new Date();
    
    const agendamento: AgendamentoStatus = {
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
    logger.info(`Agendamento criado: ${id}`, { symbol: options.symbol, date: options.date.toISOString() });
    
    return agendamento;
  }

  /**
   * Valida as opções do agendamento
   */
  private validateOptions(options: AgendamentoOptions): void {
    if (!options.symbol || options.symbol.length < 2) {
      throw new Error('Símbolo inválido');
    }
    
    if (options.quantity <= 0) {
      throw new Error('Quantidade deve ser maior que zero');
    }
    
    if (options.price && options.price <= 0) {
      throw new Error('Preço deve ser maior que zero');
    }
    
    const validSymbols = Object.keys(B3_SYMBOLS);
    if (!validSymbols.includes(options.symbol.toUpperCase())) {
      logger.warn(`Símbolo ${options.symbol} não está na lista oficial de símbolos`);
    }
  }

  /**
   * Obtém um agendamento pelo ID
   */
  public getAgendamento(id: string): AgendamentoStatus | undefined {
    return this.agendamentos.get(id);
  }

  /**
   * Lista todos os agendamentos
   */
  public listAgendamentos(): AgendamentoStatus[] {
    return Array.from(this.agendamentos.values());
  }

  /**
   * Atualiza o status de um agendamento
   */
  public updateStatus(id: string, status: AgendamentoStatus['status'], executedAt?: Date): boolean {
    const agendamento = this.agendamentos.get(id);
    if (!agendamento) {
      return false;
    }
    
    agendamento.status = status;
    agendamento.updatedAt = new Date();
    
    if (executedAt) {
      agendamento.executedAt = executedAt;
    }
    
    logger.info(`Status atualizado: ${id} -> ${status}`);
    return true;
  }

  /**
   * Cancela um agendamento
   */
  public cancelAgendamento(id: string): boolean {
    const agendamento = this.agendamentos.get(id);
    if (!agendamento || agendamento.status === 'completed' || agendamento.status === 'failed') {
      return false;
    }
    
    return this.updateStatus(id, 'cancelled');
  }

  /**
   * Verifica se o horário está dentro do horário de negócios da B3
   */
  public isHorarioNegocios(date: Date, time: string): boolean {
    const now = new Date(date);
    const [hours, minutes] = time.split(':').map(Number);
    now.setHours(hours, minutes, 0, 0);
    
    const dayOfWeek = now.getDay();
    // B3 não opera na segunda-feira (dia 1) e no domingo (dia 0)
    if (dayOfWeek === 0 || dayOfWeek === 1) {
      logger.warn(`Data ${date.toISOString()} é fim de semana`);
      return false;
    }
    
    return true;
  }

  /**
   * Gera um ID único
   */
  private generateId(): string {
    return `agr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Limpa agendamentos antigos
   */
  public cleanupCompleted(): number {
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
    logger.info(`Limpeza concluída: ${count} agendamentos removidos`);
    return count;
  }
}

export const agendamentoService = new AgendamentoB3Service();