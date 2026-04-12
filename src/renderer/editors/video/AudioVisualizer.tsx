import { useEffect, useRef } from "react";
import styled from "@emotion/styled";
import type { EffectType, IVisualizerEffect } from "./effects/types";
import { BarsEffect } from "./effects/BarsEffect";
import { CircularEffect } from "./effects/CircularEffect";
import color from "../../theme/color";
import { settings } from "../../api/settings";
import { isCurrentThemeDark } from "../../theme/themes";

const FFT_SIZE = 256; // 128 freq bins, 256 time-domain samples

// ── Effect factory ────────────────────────────────────────────────────────────

function createEffect(type: EffectType): IVisualizerEffect {
    switch (type) {
        case "bars":     return new BarsEffect();
        case "circular": return new CircularEffect();
    }
}

// ── Switcher icons (inline SVG, currentColor inherits from button) ─────────────

const BarsIcon = () => (
    <svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor" aria-hidden="true">
        <rect x="0"  y="5" width="2" height="7" rx="0.5"/>
        <rect x="3"  y="2" width="2" height="10" rx="0.5"/>
        <rect x="6"  y="0" width="2" height="12" rx="0.5"/>
        <rect x="9"  y="3" width="2" height="9"  rx="0.5"/>
        <rect x="12" y="6" width="2" height="6"  rx="0.5"/>
    </svg>
);

const CircularIcon = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
        <circle cx="7" cy="7" r="2.5"/>
        <line x1="7"   y1="4.5" x2="7"   y2="1"/>
        <line x1="7"   y1="9.5" x2="7"   y2="13"/>
        <line x1="4.5" y1="7"   x2="1"   y2="7"/>
        <line x1="9.5" y1="7"   x2="13"  y2="7"/>
        <line x1="5.3" y1="5.3" x2="2.9" y2="2.9"/>
        <line x1="8.7" y1="8.7" x2="11.1" y2="11.1"/>
        <line x1="8.7" y1="5.3" x2="11.1" y2="2.9"/>
        <line x1="5.3" y1="8.7" x2="2.9"  y2="11.1"/>
    </svg>
);

const EFFECTS: { type: EffectType; icon: React.ReactNode; label: string }[] = [
    { type: "bars",     icon: <BarsIcon />,     label: "Bars" },
    { type: "circular", icon: <CircularIcon />, label: "Circular" },
];

// ── Styled components ─────────────────────────────────────────────────────────

const VisualizerRoot = styled.div`
    position: relative;
    width: 100%;
    height: 100%;

    & .effect-switcher {
        opacity: 0;
        transition: opacity 0.2s ease;
    }

    &:hover .effect-switcher {
        opacity: 1;
    }
`;

const EffectSwitcher = styled.div`
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
`;

const VisualizerCanvas = styled.canvas`
    width: 100%;
    height: 100%;
    display: block;
`;

const EffectButton = styled.button<{ $active?: boolean }>`
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 4px;
    border: 1px solid ${({ $active }) => $active ? color.border.active : color.border.default};
    background: ${({ $active }) => $active ? color.background.light : color.background.dark};
    color: ${({ $active }) => $active ? color.misc.yellow : color.icon.light};
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
        border-color: ${color.border.active};
        color: ${color.misc.yellow};
    }
`;

// ── Component ─────────────────────────────────────────────────────────────────

export interface AudioVisualizerProps {
    mediaRef: React.RefObject<HTMLMediaElement>;
    playing: boolean;
}

export function AudioVisualizer({ mediaRef, playing }: AudioVisualizerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const rafRef = useRef<number>(0);
    const selectedEffect = (settings.use("visualizer-effect") || "bars") as EffectType;
    const effectRef = useRef<IVisualizerEffect>(createEffect(selectedEffect));

    // Swap effect instance when selection changes
    useEffect(() => {
        effectRef.current?.dispose?.();
        effectRef.current = createEffect(selectedEffect);
    }, [selectedEffect]);

    // Set up AudioContext lazily on first play — avoids autoplay policy block
    useEffect(() => {
        if (!playing) return;
        const media = mediaRef.current;
        if (!media || audioCtxRef.current) return;

        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = 0.8;

        const source = ctx.createMediaElementSource(media);
        source.connect(analyser);
        analyser.connect(ctx.destination);

        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
    }, [playing, mediaRef]);

    // Resume AudioContext if browser suspended it (autoplay policy)
    useEffect(() => {
        if (playing && audioCtxRef.current?.state === "suspended") {
            audioCtxRef.current.resume();
        }
    }, [playing]);

    // Animation loop — restarts when playing changes so analyserRef is fresh
    useEffect(() => {
        const canvas = canvasRef.current;
        const analyser = analyserRef.current;
        if (!canvas || !analyser) return;

        const ctx2d = canvas.getContext("2d")!;

        const draw = () => {
            rafRef.current = requestAnimationFrame(draw);
            const W = canvas.offsetWidth;
            const H = canvas.offsetHeight;
            if (canvas.width !== W) canvas.width = W;
            if (canvas.height !== H) canvas.height = H;
            effectRef.current.draw(ctx2d, analyser, W, H, isCurrentThemeDark());
        };

        rafRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(rafRef.current);
    }, [playing]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cancelAnimationFrame(rafRef.current);
            audioCtxRef.current?.close();
            audioCtxRef.current = null;
            analyserRef.current = null;
        };
    }, []);

    return (
        <VisualizerRoot>
            <VisualizerCanvas ref={canvasRef} />
            <EffectSwitcher className="effect-switcher">
                {EFFECTS.map(({ type, icon, label }) => (
                    <EffectButton
                        key={type}
                        $active={selectedEffect === type}
                        title={label}
                        onClick={(e) => { e.stopPropagation(); settings.set("visualizer-effect", type); }}
                    >
                        {icon}
                    </EffectButton>
                ))}
            </EffectSwitcher>
        </VisualizerRoot>
    );
}
