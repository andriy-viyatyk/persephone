# US-420: Bars Audio Visualizer — Iterative Improvements

## Goal

Iteratively enhance the Bars audio visualizer effect in the Video Player's audio mode. Improvements are applied incrementally based on user feedback.

---

## Background

### Current state (`BarsEffect.ts`)

File: `src/renderer/editors/video/effects/BarsEffect.ts`

```typescript
const BAR_COUNT = 48;
const BAR_GAP = 3;
const DARK_BOTTOM = "#e67e00";
const DARK_TOP = "#ffe066";
const LIGHT_BOTTOM = "#8b4d00";
const LIGHT_TOP = "#b36800";

export class BarsEffect implements IVisualizerEffect {
    private data = new Uint8Array(0);

    draw(ctx, analyser, W, H, isDark): void {
        analyser.getByteFrequencyData(this.data);
        ctx.clearRect(0, 0, W, H);

        const barWidth = (W - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;

        for (let i = 0; i < BAR_COUNT; i++) {
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
```

Key characteristics:
- 48 bars with 3px gaps
- Logarithmic frequency bin mapping (more space for bass)
- Amber→yellow gradient per bar (recreated each frame)
- Rounded top corners on each bar
- Bars grow upward from bottom
- Dark/light theme support via two color pairs

### Related files
- `src/renderer/editors/video/effects/BarsEffect.ts` — the only file to modify
- `src/renderer/editors/video/effects/types.ts` — `IVisualizerEffect` interface
- `src/renderer/editors/video/AudioVisualizer.tsx` — renders the canvas, calls `effect.draw()`

---

## Implementation Log

Changes are applied incrementally. Each entry records what was requested and what changed.

*(No changes yet — task just created.)*

---

## Acceptance Criteria

- Bars effect looks and feels improved based on user feedback
- Dark and light themes both work correctly
- No performance regressions (no heavy per-frame allocations unless justified)
