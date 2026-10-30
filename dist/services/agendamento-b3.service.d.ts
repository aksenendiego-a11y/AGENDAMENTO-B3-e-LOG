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
export declare class AgendamentoB3Service {
    private agendamentos;
    constructor();
    /**
     * Cria um novo agendamento
     */
    createAgendamento(options: AgendamentoOptions): AgendamentoStatus;
    /**
     * Valida as opções do agendamento
     */
    private validateOptions;
    /**
     * Obtém um agendamento pelo ID
     */
    getAgendamento(id: string): AgendamentoStatus | undefined;
    /**
     * Lista todos os agendamentos
     */
    listAgendamentos(): AgendamentoStatus[];
    /**
     * Atualiza o status de um agendamento
     */
    updateStatus(id: string, status: AgendamentoStatus['status'], executedAt?: Date): boolean;
    /**
     * Cancela um agendamento
     */
    cancelAgendamento(id: string): boolean;
    /**
     * Verifica se o horário está dentro do horário de negócios da B3
     */
    isHorarioNegocios(date: Date, time: string): boolean;
    /**
     * Gera um ID único
     */
    private generateId;
    /**
     * Limpa agendamentos antigos
     */
    cleanupCompleted(): number;
}
export declare const agendamentoService: AgendamentoB3Service;
