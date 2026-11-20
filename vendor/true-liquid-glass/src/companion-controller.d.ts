import type { GlassRuntime } from './runtime.js';

export type CompanionQuality = 'low' | 'balanced' | 'high';

export interface CompanionSnapshot {
    kind: 'valid' | 'missing' | 'invalid';
    config: {
        schemaVersion: 1;
        revision: number | null;
        requestedEnabled: boolean;
        quality: CompanionQuality;
    };
    error: string | null;
}

export interface CompanionReport {
    appliedRevision: number | null;
    requestedEnabled: boolean;
    quality: CompanionQuality;
    status: 'active' | 'disabled' | 'suspended' | 'fallback' | 'error';
    reason: string | null;
}

type BridgeResult<T> = T | Promise<T>;

export interface CompanionBridge {
    open(): BridgeResult<{ sessionId: string; snapshot: CompanionSnapshot }>;
    poll(sessionId: string): BridgeResult<CompanionSnapshot>;
    report(sessionId: string, report: CompanionReport): BridgeResult<void | boolean>;
    close(sessionId: string): BridgeResult<void>;
}

export class CompanionController {
    constructor(options: {
        bridge?: CompanionBridge;
        createRuntime(options: { enabled: true; quality: CompanionQuality }): Pick<GlassRuntime, 'start' | 'stop' | 'update' | 'getStats'>;
    });
    start(): void;
    stop(): void;
    getStats(): Record<string, unknown> & CompanionReport;
}
