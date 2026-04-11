/** Supported video source formats. */
export type VideoFormat = "mp4" | "m3u8";

/** Player lifecycle states. */
export type PlayerState =
    | "stopped"
    | "loading"
    | "playing"
    | "paused"
    | "unsupported format"
    | "error";

/**
 * Infer video format from URL.
 * Returns "m3u8" if the URL contains ".m3u8" or "media-hls." — otherwise "mp4".
 */
export function detectVideoFormat(src: string): VideoFormat {
    if (src.includes(".m3u8") || src.includes("media-hls.")) return "m3u8";
    return "mp4";
}
