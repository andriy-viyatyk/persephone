export interface IVisualizerEffect {
    draw(ctx: CanvasRenderingContext2D, analyser: AnalyserNode, W: number, H: number, isDark: boolean): void;
    dispose?(): void;
}

export type EffectType = "bars" | "circular";
