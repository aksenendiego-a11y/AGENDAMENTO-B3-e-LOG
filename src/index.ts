import App from './app';
import logger from './utils/logger';

async function main() {
    try {
        const app = new App();
        app.listen();
        
        // Graceful shutdown
        process.on('SIGINT', async () => {
            logger.info('Recebido SIGINT, desligando graciosamente...');
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            logger.info('Recebido SIGTERM, desligando graciosamente...');
            process.exit(0);
        });

    } catch (error) {
        logger.error('Falha ao iniciar aplicação:', error);
        process.exit(1);
    }
}

main();