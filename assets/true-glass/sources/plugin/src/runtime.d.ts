export interface RuntimeOptions {
    enabled?: boolean;
    quality?: "low" | "balanced" | "high";
    selectors?: string[];
    resolveLocalWallpaper?: (uri: string) => Promise<{ mime: string; bytes: Uint8Array }>;
}
export class GlassRuntime {
    constructor(options?: RuntimeOptions);
    start(): void;
    stop(): void;
    update(options: RuntimeOptions): void;
    getStats(): Record<string, unknown>;
}
