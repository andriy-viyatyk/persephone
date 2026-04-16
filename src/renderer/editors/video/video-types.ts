/** Supported video source formats. */
export type VideoFormat = "mp4" | "m3u8" | "audio";

/** Player lifecycle states. */
export type PlayerState =
    | "stopped"
    | "loading"
    | "playing"
    | "paused"
    | "unsupported format"
    | "error";

export const AUDIO_EXTENSIONS = [".mp3", ".wav", ".aac", ".flac", ".m4a", ".wma", ".ogg", ".opus"];

/** Check if a file path or URL refers to an audio file by extension. */
export function isAudioFile(href: string): boolean {
    const lower = href.toLowerCase();
    return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Infer video/audio format from URL.
 * Returns "m3u8" for HLS streams, "audio" for audio-only files, "mp4" otherwise.
 */
export function detectVideoFormat(src: string): VideoFormat {
    if (src.includes(".m3u8") || src.includes("media-hls.")) return "m3u8";
    const lower = src.toLowerCase();
    if (AUDIO_EXTENSIONS.some((ext) => lower.includes(ext))) return "audio";
    return "mp4";
}
