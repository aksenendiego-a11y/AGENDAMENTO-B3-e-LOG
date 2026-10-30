import express, { Express, Request, Response } from 'express';
import { agendamentoService } from './services/agendamento-b3.service';
import { logService } from './services/log.service';
import logger from './utils/logger';
import { B3_TRADING_HOURS, B3_SYMBOLS } from './config/constants';

class App {
    private app: Express;
    private port: number;

    constructor() {
        this.app = express();
        this.port = parseInt(process.env.PORT || '3000');
        this.initializeMiddlewares();
        this.initializeRoutes();
    }

    private initializeMiddlewares(): void {
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    }

    private initializeRoutes(): void {
        const router = express.Router();

        // Health check
        router.get('/health', (req: Request, res: Response) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });

        // Agendamento B3
        router.post('/agendamento/b3', async (req: Request, res: Response) => {
            try {
                const { symbol, date, time, quantity, price, operationType } = req.body;
                if (!symbol || !date || !time || !quantity) {
                    return res.status(400).json({ error: 'Missing required fields' });
                }
                const agendamento = agendamentoService.createAgendamento({
                    symbol,
                    date: new Date(date),
                    time,
                    quantity: parseInt(quantity),
                    price: price ? parseFloat(price) : undefined,
                });
                logger.info('Agendamento criado via API', { id: agendamento.id, symbol, time });
                return res.status(201).json({
                    id: agendamento.id,
                    status: agendamento.status,
                    symbol: agendamento.symbol,
                    date: agendamento.date,
                    time: agendamento.time,
                    quantity: agendamento.quantity
                });
            } catch (error: any) {
                logger.error('Falha ao criar agendamento', error);
                return res.status(500).json({ error: error.message });
            }
        });

        router.get('/agendamento/b3', async (req: Request, res: Response) => {
            try {
                const agendamentos = agendamentoService.listAgendamentos();
                return res.json({ agendamentos });
            } catch (error: any) {
                logger.error('Falha ao listar agendamentos', error);
                return res.status(500).json({ error: error.message });
            }
        });

        router.get('/agendamento/b3/:id', async (req: Request, res: Response) => {
            try {
                const { id } = req.params;
                const agendamento = agendamentoService.getAgendamento(id);
                if (!agendamento) {
                    return res.status(404).json({ error: 'Agendamento não encontrado' });
                }
                return res.json({ agendamento });
            } catch (error: any) {
                logger.error('Falha ao obter agendamento', error);
                return res.status(500).json({ error: error.message });
            }
        });

        // Status do mercado B3
        router.get('/agendamento/b3/status/mercado', async (req: Request, res: Response) => {
            try {
                const agora = new Date();
                const aberto = this.isHorarioNegociosFunc(agora);
                return res.json({
                    marketOpen: aberto,
                    tradingHours: B3_TRADING_HOURS,
                    timezone: B3_TRADING_HOURS.TIMEZONE,
                    symbols: Object.keys(B3_SYMBOLS).length
                });
            } catch (error: any) {
                logger.error('Falha ao obter status do mercado', error);
                return res.status(500).json({ error: error.message });
            }
        });

        // Logs
        router.get('/logs', async (req: Request, res: Response) => {
            try {
                const limit = parseInt(req.query.limit as string || '100');
                const logs = await logService.getLogs(limit);
                return res.json({ logs });
            } catch (error: any) {
                logger.error('Falha ao obter logs', error);
                return res.status(500).json({ error: error.message });
            }
        });

        router.post('/logs/clear', async (req: Request, res: Response) => {
            try {
                await logService.clearLogs();
                return res.json({ success: true });
            } catch (error: any) {
                logger.error('Falha ao limpar logs', error);
                return res.status(500).json({ error: error.message });
            }
        });

        router.get('/logs/summary', async (req: Request, res: Response) => {
            try {
                const summary = await logService.getLogSummary();
                return res.json({ summary });
            } catch (error: any) {
                logger.error('Falha ao obter resumo de logs', error);
                return res.status(500).json({ error: error.message });
            }
        });

        this.app.use('/api', router);
    }

    private isHorarioNegociosFunc(date: Date): boolean {
        const hora = date.getHours();
        return hora >= 9 && hora < 17;
    }

    public listen(): void {
        this.app.listen(this.port, () => {
            logger.info(`SAD System API rodando na porta ${this.port}`);
        });
    }

    public getApp(): Express {
        return this.app;
    }
}

export default App;