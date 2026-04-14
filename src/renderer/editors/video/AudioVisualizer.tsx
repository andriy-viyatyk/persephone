import { useEffect, useRef, useState } from "react";
import styled from "@emotion/styled";
import type { EffectType, IVisualizerEffect } from "./effects/types";
import { BarsEffect } from "./effects/BarsEffect";
import { CircularEffect } from "./effects/CircularEffect";
import color from "../../theme/color";
import { settings } from "../../api/settings";
import { isCurrentThemeDark } from "../../theme/themes";

const FFT_SIZE = 256; // 128 freq bins, 256 time-domain samples

// ── Effect factory ────────────────────────────────────────────────────────────

function createEffect(type: EffectType): IVisualizerEffect | null {
    switch (type) {
        case "bars":     return new BarsEffect();
        case "circular": return new CircularEffect();
        case "none":     return null;
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

const NoneIcon = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
        <circle cx="7" cy="7" r="5.5"/>
        <line x1="3.1" y1="3.1" x2="10.9" y2="10.9"/>
    </svg>
);

const EFFECTS: { type: EffectType; icon: React.ReactNode; label: string }[] = [
    { type: "bars",     icon: <BarsIcon />,     label: "Bars" },
    { type: "circular", icon: <CircularIcon />, label: "Circular" },
    { type: "none",     icon: <NoneIcon />,     label: "No effect" },
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

    & .track-info-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        pointer-events: none;
    }

    & .track-title {
        font-size: 16px;
        font-weight: 600;
        color: ${color.text.normal};
        text-align: center;
        max-width: 80%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    & .track-artist {
        font-size: 13px;
        color: ${color.text.muted};
        text-align: center;
        max-width: 80%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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

interface TrackInfo {
    title: string;
    artist: string;
}

export interface AudioVisualizerProps {
    mediaRef: React.RefObject<HTMLMediaElement>;
    playing: boolean;
    sourceUrl?: string;
}

/** Extract artist/title from a file path or URL when no ID3 tags are available.
 *  Tries to split on " – " (en-dash) or " - " (hyphen). */
function parseFilenameInfo(sourceUrl: string): TrackInfo | null {
    // Extract filename without extension
    const basename = sourceUrl.replace(/\\/g, "/").split("/").pop() ?? "";
    const name = basename.replace(/\.[^.]+$/, "").trim();
    if (!name) return null;
    const sep = name.includes(" \u2013 ") ? " \u2013 " : name.includes(" - ") ? " - " : null;
    if (sep) {
        const idx = name.indexOf(sep);
        return { artist: name.slice(0, idx).trim(), title: name.slice(idx + sep.length).trim() };
    }
    return { artist: "", title: name };
}

export function AudioVisualizer({ mediaRef, playing, sourceUrl }: AudioVisualizerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const rafRef = useRef<number>(0);
    const selectedEffect = (settings.use("visualizer-effect") || "bars") as EffectType;
    const effectRef = useRef<IVisualizerEffect | null>(createEffect(selectedEffect));
    const [trackInfo, setTrackInfo] = useState<TrackInfo | null>(null);

    // Swap effect instance when selection changes
    useEffect(() => {
        effectRef.current?.dispose?.();
        effectRef.current = createEffect(selectedEffect);
    }, [selectedEffect]);

    // Read track metadata — try MediaSession ID3 tags first, fall back to filename
    useEffect(() => {
        const media = mediaRef.current;
        if (!media) return;
        const onMeta = () => {
            const meta = navigator.mediaSession?.metadata;
            if (meta?.title || meta?.artist) {
                setTrackInfo({ title: meta.title || "", artist: meta.artist || "" });
            } else if (sourceUrl) {
                setTrackInfo(parseFilenameInfo(sourceUrl));
            } else {
                setTrackInfo(null);
            }
        };
        media.addEventListener("loadedmetadata", onMeta);
        const onEmpty = () => setTrackInfo(null);
        media.addEventListener("emptied", onEmpty);
        return () => {
            media.removeEventListener("loadedmetadata", onMeta);
            media.removeEventListener("emptied", onEmpty);
        };
    }, [mediaRef, sourceUrl]);

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

    // Animation loop — restarts when playing or selectedEffect changes
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // "none" — just clear the canvas, no RAF loop needed
        if (selectedEffect === "none") {
            const ctx2d = canvas.getContext("2d");
            ctx2d?.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        const analyser = analyserRef.current;
        if (!analyser) return;

        const ctx2d = canvas.getContext("2d")!;

        const draw = () => {
            rafRef.current = requestAnimationFrame(draw);
            const W = canvas.offsetWidth;
            const H = canvas.offsetHeight;
            if (canvas.width !== W) canvas.width = W;
            if (canvas.height !== H) canvas.height = H;
            effectRef.current?.draw(ctx2d, analyser, W, H, isCurrentThemeDark());
        };

        rafRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(rafRef.current);
    }, [playing, selectedEffect]);

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
            {selectedEffect === "none" && trackInfo && (
                <div className="track-info-overlay">
                    {trackInfo.title  && <div className="track-title">{trackInfo.title}</div>}
                    {trackInfo.artist && <div className="track-artist">{trackInfo.artist}</div>}
                </div>
            )}
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
