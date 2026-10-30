import { Express } from 'express';
declare class App {
    private app;
    private port;
    constructor();
    private initializeMiddlewares;
    private initializeRoutes;
    private isHorarioNegociosFunc;
    listen(): void;
    getApp(): Express;
}
export default App;
