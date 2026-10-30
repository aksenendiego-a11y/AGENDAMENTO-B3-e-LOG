#!/usr/bin/env node
declare class SystemInitializer {
    static run(): Promise<void>;
    static checkDependencies(): Promise<void>;
    static startEssentialServices(): Promise<void>;
    static showSystemStatus(): Promise<void>;
}
export default SystemInitializer;
