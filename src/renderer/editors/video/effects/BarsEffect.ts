import type { IVisualizerEffect } from "./types";

const BAR_COUNT = 48;
const BAR_GAP = 3;
const DARK_BOTTOM = "#e67e00";
const DARK_TOP = "#ffe066";
const LIGHT_BOTTOM = "#8b4d00";
const LIGHT_TOP = "#b36800";

export class BarsEffect implements IVisualizerEffect {
    private data = new Uint8Array(0);

    draw(ctx: CanvasRenderingContext2D, analyser: AnalyserNode, W: number, H: number, isDark: boolean): void {
        if (this.data.length !== analyser.frequencyBinCount) {
            this.data = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(this.data);
        ctx.clearRect(0, 0, W, H);

        const barWidth = (W - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;

        for (let i = 0; i < BAR_COUNT; i++) {
            // Logarithmic-ish frequency bin mapping — gives more space to bass
            const binIndex = Math.round(
                Math.pow(i / BAR_COUNT, 1.5) * (this.data.length - 1),
            );
            const value = this.data[binIndex] / 255;
            const barH = Math.max(2, value * H * 0.9);
            const x = i * (barWidth + BAR_GAP);
            const y = H - barH;

            const grad = ctx.createLinearGradient(x, H, x, y);
            grad.addColorStop(0, isDark ? DARK_BOTTOM : LIGHT_BOTTOM);
            grad.addColorStop(1, isDark ? DARK_TOP : LIGHT_TOP);

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barH, [2, 2, 0, 0]);
            ctx.fill();
        }
    }
}
