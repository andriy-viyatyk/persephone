import { useEffect, useRef, useState } from "react";
import styled from "@emotion/styled";
import { AudioVisualizer } from "./AudioVisualizer";
import { AudioControls } from "./AudioControls";
import type { PlayerState } from "./video-types";
import color from "../../theme/color";

export interface AudioPlayerProps {
    src: string;
    muted?: boolean;
    /** Original file path or URL — used for filename-based metadata fallback in the visualizer. */
    sourceUrl?: string;
    onStateChangeRef: React.RefObject<((state: PlayerState, error?: unknown) => void) | undefined>;
    onMutedChangeRef: React.RefObject<((muted: boolean) => void) | undefined>;
}

const AudioPlayerRoot = styled.div`
    position: absolute;
    inset: 0;

    & .visualizer-area {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: ${color.background.dark};
        cursor: pointer;
    }

    & .controls-overlay {
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        width: 33%;
        min-width: 260px;
        border-radius: 8px;
        overflow: hidden;
        pointer-events: auto;
        background: transparent;
        transition: background 0.2s ease;
    }

    &:hover .controls-overlay {
        background: ${color.background.dark};
    }

    & .controls-overlay:hover input[type="range"] {
        opacity: 1;
    }

    & .controls-overlay .idle-hide {
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
    }

    & .controls-overlay:hover .idle-hide {
        opacity: 1;
        pointer-events: auto;
    }
`;

export function AudioPlayer({ src, muted, sourceUrl, onStateChangeRef, onMutedChangeRef }: AudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const onLoadStart = () => onStateChangeRef.current?.("loading");
        const onPlaying = () => { onStateChangeRef.current?.("playing"); setPlaying(true); };
        const onPause = () => { onStateChangeRef.current?.("paused"); setPlaying(false); };
        const onVolumeChange = () => onMutedChangeRef.current?.(audio.muted);
        const onError = () => {
            setPlaying(false);
            const err = audio.error;
            if (err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
                onStateChangeRef.current?.("unsupported format", err);
            } else {
                onStateChangeRef.current?.("error", err ?? undefined);
            }
        };

        audio.addEventListener("loadstart", onLoadStart);
        audio.addEventListener("playing", onPlaying);
        audio.addEventListener("pause", onPause);
        audio.addEventListener("volumechange", onVolumeChange);
        audio.addEventListener("error", onError);

        return () => {
            audio.removeEventListener("loadstart", onLoadStart);
            audio.removeEventListener("playing", onPlaying);
            audio.removeEventListener("pause", onPause);
            audio.removeEventListener("volumechange", onVolumeChange);
            audio.removeEventListener("error", onError);
        };
    }, [onStateChangeRef, onMutedChangeRef]);

    useEffect(() => {
        if (audioRef.current) audioRef.current.muted = muted ?? false;
    }, [muted]);

    return (
        <AudioPlayerRoot>
            <div
                className="visualizer-area"
                onClick={() => {
                    const audio = audioRef.current;
                    if (audio) audio.paused ? audio.play() : audio.pause();
                }}
            >
                <AudioVisualizer mediaRef={audioRef} playing={playing} sourceUrl={sourceUrl} />
            </div>
            <audio ref={audioRef} src={src} autoPlay muted={muted} style={{ display: "none" }} />
            <div className="controls-overlay">
                <AudioControls audioRef={audioRef} playing={playing} />
            </div>
        </AudioPlayerRoot>
    );
}
