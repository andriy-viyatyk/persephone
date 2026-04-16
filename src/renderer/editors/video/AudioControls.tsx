import { useEffect, useRef, useState } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { PlayIcon, PauseIcon, VolumeIcon, VolumeMutedIcon, ShuffleIcon, NextTrackIcon } from "../../theme/icons";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(sec: number): string {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Styled components ─────────────────────────────────────────────────────────

const AudioControlsRoot = styled.div`
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    background: transparent;

    & .control-button {
        width: 32px;
        height: 32px;
        border: none;
        background: none;
        color: ${color.icon.light};
        cursor: pointer;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        padding: 0;

        &:hover {
            color: ${color.icon.default};
            background: ${color.background.light};
        }

        & svg {
            width: 18px;
            height: 18px;
        }
    }

    & .time-label {
        font-size: 11px;
        color: ${color.text.muted};
        min-width: 34px;
        white-space: nowrap;
        text-align: center;
        flex-shrink: 0;
    }

    & .seek-bar {
        flex: 1;
        height: 4px;
        appearance: none;
        border-radius: 2px;
        outline: none;
        cursor: pointer;
        opacity: 0.4;
        transition: opacity 0.2s ease;

        &:hover {
            opacity: 1;
        }

        &::-webkit-slider-thumb {
            appearance: none;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: ${color.border.active};
            margin-top: -4px;
            transition: transform 0.1s ease;
        }

        &:hover::-webkit-slider-thumb {
            transform: scale(1.3);
        }

        &::-webkit-slider-runnable-track {
            height: 4px;
            border-radius: 2px;
        }
    }
`;

// ── Component ─────────────────────────────────────────────────────────────────

export interface AudioControlsProps {
    audioRef: React.RefObject<HTMLAudioElement>;
    playing: boolean;
    /** Whether a next track is available. */
    hasNext?: boolean;
    /** Whether shuffle mode is on. */
    shuffle?: boolean;
    /** Skip to the next track. */
    onNext?: () => void;
    /** Toggle shuffle mode. */
    onToggleShuffle?: () => void;
}

export function AudioControls({ audioRef, playing, hasNext, shuffle, onNext, onToggleShuffle }: AudioControlsProps) {
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration]       = useState(0);
    const [muted, setMuted]             = useState(false);
    const isSeekingRef                  = useRef(false);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const onTimeUpdate    = () => { if (!isSeekingRef.current) setCurrentTime(audio.currentTime); };
        const onDuration      = () => { setDuration(isFinite(audio.duration) ? audio.duration : 0); };
        const onVolumeChange  = () => { setMuted(audio.muted); };
        const onSeeked        = () => { setCurrentTime(audio.currentTime); };

        audio.addEventListener("timeupdate",      onTimeUpdate);
        audio.addEventListener("loadedmetadata",  onDuration);
        audio.addEventListener("durationchange",  onDuration);
        audio.addEventListener("volumechange",    onVolumeChange);
        audio.addEventListener("seeked",          onSeeked);
        // Sync initial state
        setCurrentTime(audio.currentTime);
        setDuration(isFinite(audio.duration) ? audio.duration : 0);
        setMuted(audio.muted);

        return () => {
            audio.removeEventListener("timeupdate",     onTimeUpdate);
            audio.removeEventListener("loadedmetadata", onDuration);
            audio.removeEventListener("durationchange", onDuration);
            audio.removeEventListener("volumechange",   onVolumeChange);
            audio.removeEventListener("seeked",         onSeeked);
        };
    }, [audioRef]);

    const togglePlay = () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) audio.play().catch(() => {});
        else audio.pause();
    };

    const toggleMute = () => {
        const audio = audioRef.current;
        if (audio) audio.muted = !audio.muted;
    };

    const onSeekMouseDown = () => { isSeekingRef.current = true; };
    const onSeekMouseUp   = () => { isSeekingRef.current = false; };
    const onSeekChange    = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = Number(e.target.value);
        setCurrentTime(val);
        const audio = audioRef.current;
        if (audio) audio.currentTime = val;
    };

    const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
    const seekBackground = `linear-gradient(to right, ${color.border.active} ${pct}%, ${color.border.default} ${pct}%)`;

    return (
        <AudioControlsRoot>
            <button className="control-button idle-hide" onClick={togglePlay} title={playing ? "Pause" : "Play"}>
                {playing ? <PauseIcon /> : <PlayIcon />}
            </button>

            {hasNext && (
                <button className="control-button idle-hide" onClick={onNext} title="Next Track">
                    <NextTrackIcon />
                </button>
            )}

            <span className="time-label idle-hide">{formatTime(currentTime)}</span>

            <input
                type="range"
                className="seek-bar"
                style={{ background: seekBackground }}
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={onSeekChange}
                onMouseDown={onSeekMouseDown}
                onMouseUp={onSeekMouseUp}
            />

            <span className="time-label idle-hide">{formatTime(duration)}</span>

            <button className="control-button idle-hide" onClick={toggleMute} title={muted ? "Unmute" : "Mute"}>
                {muted ? <VolumeMutedIcon /> : <VolumeIcon />}
            </button>

            {hasNext && (
                <button
                    className="control-button idle-hide"
                    onClick={onToggleShuffle}
                    title={shuffle ? "Shuffle: On" : "Shuffle: Off"}
                    style={shuffle ? { color: color.misc.blue } : undefined}
                >
                    <ShuffleIcon />
                </button>
            )}
        </AudioControlsRoot>
    );
}
