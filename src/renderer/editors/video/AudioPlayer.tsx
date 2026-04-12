import { useEffect, useRef, useState } from "react";
import styled from "@emotion/styled";
import { AudioVisualizer } from "./AudioVisualizer";
import type { PlayerState } from "./video-types";
import color from "../../theme/color";
import { isCurrentThemeDark } from "../../theme/themes";

export interface AudioPlayerProps {
    src: string;
    muted?: boolean;
    onStateChangeRef: React.RefObject<((state: PlayerState, error?: unknown) => void) | undefined>;
    onMutedChangeRef: React.RefObject<((muted: boolean) => void) | undefined>;
}

const AudioPlayerRoot = styled.div`
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;

    & .visualizer-area {
        flex: 1;
        position: relative;
        overflow: hidden;
        background: ${color.background.dark};
        cursor: pointer;
    }

    & audio.audio-native {
        width: 100%;
        height: 40px;
        flex-shrink: 0;
        outline: none;
        background: ${color.background.dark};
    }
`;

export function AudioPlayer({ src, muted, onStateChangeRef, onMutedChangeRef }: AudioPlayerProps) {
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
                <AudioVisualizer mediaRef={audioRef} playing={playing} />
            </div>
            <audio
                ref={audioRef}
                className="audio-native"
                src={src}
                controls
                autoPlay
                muted={muted}
                style={{ colorScheme: isCurrentThemeDark() ? "dark" : "light" }}
            />
        </AudioPlayerRoot>
    );
}
