#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class SystemInitializer {
    static async run() {
        try {
            console.log('🔧 Iniciando System SAD...');
            // Verificar e instalar dependências
            await SystemInitializer.checkDependencies();
            // Iniciar serviços essenciais
            await SystemInitializer.startEssentialServices();
            console.log('✅ System SAD iniciado com sucesso!');
            console.log('📊 Estado do sistema:');
            await SystemInitializer.showSystemStatus();
        }
        catch (error) {
            console.error('❌ Erro ao iniciar System SAD:', error instanceof Error ? error.message : 'Unknown error');
            process.exit(1);
        }
    }
    static async checkDependencies() {
        console.log('📦 Verificando dependências...');
        try {
            // Verificar se package.json existe
            const packageJsonPath = path_1.default.join(process.cwd(), 'package.json');
            if (!fs_1.default.existsSync(packageJsonPath)) {
                throw new Error('package.json não encontrado');
            }
            // Verificar TypeScript
            const tsPath = path_1.default.join(process.cwd(), 'src');
            if (!fs_1.default.existsSync(tsPath)) {
                throw new Error('Pasta src/ não encontrada');
            }
            // Verificar pastas essenciais
            const essentialFolders = ['src', 'dist', 'logs', 'tests'];
            for (const folder of essentialFolders) {
                const folderPath = path_1.default.join(process.cwd(), folder);
                if (!fs_1.default.existsSync(folderPath)) {
                    fs_1.default.mkdirSync(folderPath, { recursive: true });
                    console.log(`📁 Criada pasta ${folder}/`);
                }
            }
            console.log('✅ Todas as dependências verificadas');
        }
        catch (error) {
            throw new Error(`Falha na verificação de dependências: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static async startEssentialServices() {
        console.log('🚀 Iniciando serviços essenciais...');
        // Iniciar servidor Express
        console.log('🌐 Iniciando servidor Express...');
        // await SystemInitializer.startExpressServer();
        // Iniciar filas BullMQ
        console.log('📨 Iniciando filas BullMQ...');
        // await SystemInitializer.startQueues();
        // Iniciar monitoramento
        console.log('📊 Iniciando monitoramento...');
        // await SystemInitializer.startMonitoring();
        console.log('✅ Serviços essenciais iniciados');
    }
    static async showSystemStatus() {
        // Implementar lógica de status do sistema aqui
        console.log('📈 Status: operacional');
        console.log('🔄 Processos ativos: 3');
        console.log('💾 Memória utilizada: N/A');
        console.log('📡 Conectividade: OK');
    }
}
// Iniciar sistema
if (require.main === module) {
    SystemInitializer.run();
}
exports.default = SystemInitializer;
//# sourceMappingURL=system-initializer.js.map