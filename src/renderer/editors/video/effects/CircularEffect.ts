import type { IVisualizerEffect } from "./types";

// Three frequency bands mapped to RGB rings
const BANDS = [
    { startFrac: 0.000, endFrac: 0.060, darkRgb: "70, 15, 7",  lightRgb: "180, 40, 10",  baseR: 0.00, rotSpeed:  0.003,     segments: 16, modSource: 2, expansionScale: 1.0 }, // bass modulated by treble
    { startFrac: 0.060, endFrac: 0.280, darkRgb: "12, 60, 16", lightRgb: "10, 140, 30",  baseR: 0.44, rotSpeed: -0.00143,  segments: 24, modSource: 0, expansionScale: 0.7 }, // mid modulated by bass
    { startFrac: 0.280, endFrac: 0.650, darkRgb: "15, 32, 70", lightRgb: "20, 60, 180",  baseR: 0.74, rotSpeed:  0.0009375, segments: 32, modSource: 1, expansionScale: 0.5 }, // treble modulated by mid
] as const;

const MAX_SPIKE_FRAC  = 0.11;
const EXPANSION       = 0.30;
const SAMPLES_PER_SEG = 8;
const MOD_STRENGTH    = 0.6;
const GLOW_WIDTH      = 14;
const GLOW_PAD        = Math.ceil(GLOW_WIDTH / 2) + 2;

// Reorder: center-out mapping so loudest spike is at the center of each segment
const REORDER = (() => {
    const map = new Uint8Array(SAMPLES_PER_SEG);
    const center = SAMPLES_PER_SEG >> 1;
    let s = 0;
    map[center] = s++;
    for (let off = 1; s < SAMPLES_PER_SEG; off++) {
        if (center - off >= 0)                                     map[center - off] = s++;
        if (center + off < SAMPLES_PER_SEG && s < SAMPLES_PER_SEG) map[center + off] = s++;
    }
    return map;
})();

const MOD_SAMPLES = 64;

// One extra point per segment for seamless overlap with adjacent stamps
const SEG_PTS = SAMPLES_PER_SEG + 1;

export class CircularEffect implements IVisualizerEffect {
    private data           = new Uint8Array(0);
    private smoothedEnergy = new Float32Array(BANDS.length);
    private smoothedBins   = Array.from({ length: BANDS.length }, () => new Float32Array(SAMPLES_PER_SEG));
    private modBins        = Array.from({ length: BANDS.length }, () => new Float32Array(MOD_SAMPLES));
    private rotations      = new Float32Array(BANDS.length);

    // Offscreen canvas for draw-once-stamp-many optimization
    private oc: OffscreenCanvas | null = null;
    private octx: OffscreenCanvasRenderingContext2D | null = null;
    private ocW = 0;
    private ocH = 0;

    // Pre-allocated segment point arrays (reused per band per frame)
    private segOX = new Float32Array(SEG_PTS);
    private segOY = new Float32Array(SEG_PTS);
    private segIX = new Float32Array(SEG_PTS);
    private segIY = new Float32Array(SEG_PTS);

    dispose(): void {
        this.oc = null;
        this.octx = null;
    }

    draw(ctx: CanvasRenderingContext2D, analyser: AnalyserNode, W: number, H: number, isDark: boolean): void {
        if (this.data.length !== analyser.frequencyBinCount) {
            this.data = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(this.data);

        // Fade trail
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = isDark ? "rgba(0, 0, 0, 0.28)" : "rgba(255, 255, 255, 0.28)";
        ctx.fillRect(0, 0, W, H);

        const cx       = W / 2;
        const cy       = H / 2;
        const unit     = Math.min(W, H) / 2;
        const binCount = this.data.length;

        // ── EMA smoothing ────────────────────────────────────────────────────
        for (let i = 0; i < BANDS.length; i++) {
            const { startFrac, endFrac } = BANDS[i];
            const binStart  = Math.round(startFrac * binCount);
            const binEnd    = Math.max(binStart + 1, Math.round(endFrac * binCount));
            const bandRange = binEnd - binStart;

            let sum = 0;
            for (let b = binStart; b < binEnd; b++) sum += this.data[b];
            this.smoothedEnergy[i] = this.smoothedEnergy[i] * 0.62 + (sum / bandRange / 255) * 0.38;

            for (let s = 0; s < SAMPLES_PER_SEG; s++) {
                const exact = binStart + (s / SAMPLES_PER_SEG) * (bandRange - 1);
                const lo    = Math.floor(exact);
                const hi    = Math.min(lo + 1, binEnd - 1);
                const raw   = (this.data[lo] * (1 - (exact - lo)) + this.data[hi] * (exact - lo)) / 255;
                this.smoothedBins[i][s] = this.smoothedBins[i][s] * 0.60 + raw * 0.40;
            }

            for (let s = 0; s < MOD_SAMPLES; s++) {
                const exact = binStart + (s / MOD_SAMPLES) * (bandRange - 1);
                const lo    = Math.floor(exact);
                const hi    = Math.min(lo + 1, binEnd - 1);
                const raw   = (this.data[lo] * (1 - (exact - lo)) + this.data[hi] * (exact - lo)) / 255;
                this.modBins[i][s] = this.modBins[i][s] * 0.55 + raw * 0.45;
            }
        }

        // ── Ensure offscreen canvas is large enough ──────────────────────────
        // Max radius: largest baseR + max expansion + bar spike overshoot + glow pad
        const maxR   = unit * (0.74 + 0.30 + 0.11 * 1.5) + GLOW_PAD;
        const maxSeg = Math.PI * 2 / 16; // largest segment angle (bass, 16 segments)
        const needW  = Math.ceil(maxR) + GLOW_PAD * 2;
        const needH  = Math.ceil(maxR * Math.sin(maxSeg)) + GLOW_PAD * 2;

        if (!this.oc || this.ocW < needW || this.ocH < needH) {
            this.ocW = needW;
            this.ocH = needH;
            this.oc   = new OffscreenCanvas(needW, needH);
            this.octx = this.oc.getContext("2d")!;
        }

        // ── Draw & stamp each band ───────────────────────────────────────────
        ctx.globalCompositeOperation = isDark ? "lighter" : "multiply";

        for (let i = 0; i < BANDS.length; i++) {
            const band     = BANDS[i];
            const energy   = this.smoothedEnergy[i];
            const ringR    = unit * (band.baseR + energy * energy * EXPANSION * band.expansionScale);
            const maxSpike = unit * MAX_SPIKE_FRAC;
            const segments = band.segments;
            const segAngle = Math.PI * 2 / segments;
            const baseAlpha = 0.20 + energy * 0.80;
            const color    = `rgb(${isDark ? band.darkRgb : band.lightRgb})`;

            // Ring center in offscreen coords
            const ox = GLOW_PAD;
            const oy = GLOW_PAD;

            // ── Compute one segment's points (SEG_PTS = 9 points) ────────────
            for (let s = 0; s < SEG_PTS; s++) {
                const angle  = (s / SAMPLES_PER_SEG) * segAngle;
                const segIdx = REORDER[s % SAMPLES_PER_SEG];
                const amp    = Math.pow(this.smoothedBins[i][segIdx], 1.8) * maxSpike;
                const c      = Math.cos(angle);
                const sn     = Math.sin(angle);
                this.segOX[s] = ox + c * (ringR + amp);
                this.segOY[s] = oy + sn * (ringR + amp);
                this.segIX[s] = ox + c * (ringR - amp * 0.5);
                this.segIY[s] = oy + sn * (ringR - amp * 0.5);
            }

            // ── Draw segment on offscreen canvas ─────────────────────────────
            const oc = this.octx!;
            oc.clearRect(0, 0, this.ocW, this.ocH);

            // Glow: wide low-alpha stroke along outer edge
            oc.globalAlpha = baseAlpha * 0.20;
            oc.strokeStyle = color;
            oc.lineWidth   = GLOW_WIDTH;
            oc.lineJoin    = "round";
            oc.lineCap     = "round";
            oc.beginPath();
            oc.moveTo(this.segOX[0], this.segOY[0]);
            for (let s = 1; s < SEG_PTS; s++) oc.lineTo(this.segOX[s], this.segOY[s]);
            oc.stroke();

            // Flame fill: closed wedge (outer forward → inner backward)
            oc.globalAlpha = baseAlpha * 0.90;
            oc.fillStyle   = color;
            oc.beginPath();
            oc.moveTo(this.segOX[0], this.segOY[0]);
            for (let s = 1; s < SEG_PTS; s++) oc.lineTo(this.segOX[s], this.segOY[s]);
            oc.lineTo(this.segIX[SEG_PTS - 1], this.segIY[SEG_PTS - 1]);
            for (let s = SEG_PTS - 2; s >= 0; s--) oc.lineTo(this.segIX[s], this.segIY[s]);
            oc.closePath();
            oc.fill();

            // Bar spikes: bright white lines over the flame
            let peakAmp = 0;
            oc.beginPath();
            for (let s = 0; s < SAMPLES_PER_SEG; s++) {
                const segIdx  = REORDER[s];
                const amp     = Math.pow(this.smoothedBins[i][segIdx], 1.8);
                if (amp < 0.05) continue;
                if (amp > peakAmp) peakAmp = amp;

                const angle    = (s / SAMPLES_PER_SEG) * segAngle;
                const spikeLen = amp * maxSpike * 1.5;
                const c        = Math.cos(angle);
                const sn       = Math.sin(angle);

                // Outer bar
                oc.moveTo(ox + c * ringR, oy + sn * ringR);
                oc.lineTo(ox + c * (ringR + spikeLen), oy + sn * (ringR + spikeLen));
                // Inner bar
                oc.moveTo(ox + c * ringR, oy + sn * ringR);
                oc.lineTo(ox + c * (ringR - spikeLen * 0.5), oy + sn * (ringR - spikeLen * 0.5));
            }
            if (peakAmp > 0) {
                oc.globalAlpha = baseAlpha * (0.5 + peakAmp * 0.5);
                oc.strokeStyle = isDark
                    ? `rgba(255, 255, 255, ${0.6 + peakAmp * 0.4})`
                    : `rgba(0, 0, 0, ${0.6 + peakAmp * 0.4})`;
                oc.lineWidth   = 1 + peakAmp * 2;
                oc.lineCap     = "round";
                oc.stroke();
            }

            // ── Stamp N times on main canvas with rotation + modulation ──────
            const modSrc = this.modBins[band.modSource];
            for (let seg = 0; seg < segments; seg++) {
                const angle  = seg * segAngle + this.rotations[i];
                // Per-segment modulation applied as uniform alpha
                const modFrac = (seg + 0.5) / segments;
                const modIdx  = Math.round(modFrac * (MOD_SAMPLES - 1));
                const mod     = 1 - MOD_STRENGTH + modSrc[modIdx] * MOD_STRENGTH;

                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(angle);
                ctx.globalAlpha = mod;
                ctx.drawImage(this.oc!, -ox, -oy);
                ctx.restore();
            }
        }

        // Advance rotations
        for (let i = 0; i < BANDS.length; i++) {
            this.rotations[i] += BANDS[i].rotSpeed;
        }

        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1.0;
    }
}
