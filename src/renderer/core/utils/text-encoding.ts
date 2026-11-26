/**
 * Text encoding detection and conversion utilities.
 *
 * Extracted from fs.ts for use by ContentPipe. Handles BOM detection,
 * jschardet-based encoding detection, and iconv-lite encoding/decoding.
 */

import { isWindows } from "../../../shared/platform";

const iconv = require("iconv-lite");
const jschardet = require("jschardet");

export type CodecDiagnostic = (kind: "provided" | "detected" | "encode", encoding: string, error: unknown) => void;

export interface DecodedText {
    content: string;
    encoding: string;
}

const LARGE_FILE_THRESHOLD = 20 * 1024 * 1024; // 20MB
/**
 * Lowest jschardet confidence we trust. jschardet 4 scores correct single-byte answers low
 * (Cyrillic windows-1251 text 0.11–0.43, German windows-1252 0.06), while UTF-8 and ASCII score
 * 0.8–1.0. Noise such as `cp720@0.03` on an ASCII file with one `©` stays below it.
 */
const DETECTION_MIN_CONFIDENCE = 0.05;

/**
 * Normalize a locale charset only when it names a supported legacy codec.
 * Arbitrary iconv codecs are intentionally excluded because locale strings are only a hint.
 */
function normalizeLegacyLocaleCharset(charset: string): string | undefined {
    const normalized = charset.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (/^cp\d+$/.test(normalized)) {
        if (!iconv.encodingExists(normalized)) return undefined;
        const encoding = normalized === "cp1251" ? "windows-1251" : normalized;
        return iconv.encodingExists(encoding) ? encoding : undefined;
    }
    if (/^windows\d+$/.test(normalized)) {
        const encoding = normalized.replace(/^windows/, "windows-");
        return iconv.encodingExists(encoding) ? encoding : undefined;
    }
    if (/^iso8859\d+$/.test(normalized)) {
        const encoding = normalized.replace(/^iso8859/, "iso-8859-");
        return iconv.encodingExists(encoding) ? encoding : undefined;
    }
    if (normalized === "koi8r" || normalized === "koi8u") {
        if (!iconv.encodingExists(normalized)) return undefined;
        const encoding = normalized === "koi8r" ? "koi8-r" : "koi8-u";
        return iconv.encodingExists(encoding) ? encoding : undefined;
    }

    return undefined;
}

/** Select the last-resort codec from the host platform and inherited locale environment. */
function defaultTextEncoding(): string {
    if (isWindows) return "windows-1251";

    const locale = [process.env.LC_ALL, process.env.LC_CTYPE, process.env.LANG]
        .find((value) => value?.trim());
    if (!locale) return "utf-8";

    const normalizedLocale = locale.trim();
    if (/^(?:c|posix)$/i.test(normalizedLocale)) return "utf-8";

    const localeParts = normalizedLocale.match(/^[a-z0-9_-]+\.([^.@\s]+)(?:@[a-z0-9_-]+)?$/i);
    if (!localeParts) return "utf-8";

    return normalizeLegacyLocaleCharset(localeParts[1]) ?? "utf-8";
}

/**
 * Decode a binary buffer to string with automatic encoding detection.
 *
 * Detection order:
 * 1. BOM (UTF-8-BOM, UTF-16LE, UTF-16BE) — O(1)
 * 2. Skip detection for files >20MB (use UTF-8)
 * 3. Explicit encoding override (if provided)
 * 4. jschardet detection (above DETECTION_MIN_CONFIDENCE)
 * 5. UTF-8 without replacement characters
 * 6. Fallback: Windows-1251 on Windows; supported legacy charset from locale elsewhere, else UTF-8
 */
export function decodeBuffer(buffer: Buffer, encoding?: string, diagnostic?: CodecDiagnostic): DecodedText {
    // BOM detection
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return { content: buffer.slice(3).toString("utf-8"), encoding: "utf-8-bom" };
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return { content: iconv.decode(buffer.slice(2), "utf16le"), encoding: "utf-16le" };
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        return { content: iconv.decode(buffer.slice(2), "utf16be"), encoding: "utf-16be" };
    }

    // Large files: skip detection
    if (buffer.length > LARGE_FILE_THRESHOLD) {
        return { content: buffer.toString("utf-8"), encoding: "utf-8" };
    }

    // Explicit encoding override
    if (encoding) {
        try {
            return { content: iconv.decode(buffer, encoding), encoding };
        } catch (error) {
            diagnostic?.("provided", encoding, error);
            // Fall through to auto-detection
        }
    }

    // jschardet detection
    const detected = jschardet.detect(buffer);
    if (detected && detected.encoding && detected.confidence > DETECTION_MIN_CONFIDENCE) {
        try {
            let detectedEncoding = detected.encoding.toLowerCase();
            if (detectedEncoding === "ascii") {
                detectedEncoding = "utf-8";
            }
            return { content: iconv.decode(buffer, detectedEncoding), encoding: detectedEncoding };
        } catch (error) {
            diagnostic?.("detected", detected.encoding, error);
            // Fall through
        }
    }

    // UTF-8 without replacement characters
    try {
        const utf8Text = buffer.toString("utf-8");
        if (!utf8Text.includes("\ufffd")) {
            return { content: utf8Text, encoding: "utf-8" };
        }
    } catch {
        // Fall through
    }

    // Final fallback
    const fallback = defaultTextEncoding();
    return { content: iconv.decode(buffer, fallback), encoding: fallback };
}

/**
 * Encode a string into a binary buffer with the specified encoding.
 * Includes BOM for UTF-8-BOM, UTF-16LE, UTF-16BE.
 */
export function encodeString(content: string, encoding?: string, diagnostic?: CodecDiagnostic): Buffer {
    const enc = encoding?.toLowerCase() || "utf-8";

    if (enc === "utf-8" || enc === "utf8") {
        return Buffer.from(content, "utf-8");
    } else if (enc === "utf-8-bom" || enc === "utf8bom") {
        const bom = Buffer.from([0xef, 0xbb, 0xbf]);
        return Buffer.concat([bom, Buffer.from(content, "utf-8")]);
    } else if (enc === "utf-16le" || enc === "utf16le") {
        const bom = Buffer.from([0xff, 0xfe]);
        return Buffer.concat([bom, iconv.encode(content, "utf16le")]);
    } else if (enc === "utf-16be" || enc === "utf16be") {
        const bom = Buffer.from([0xfe, 0xff]);
        return Buffer.concat([bom, iconv.encode(content, "utf16be")]);
    } else {
        try {
            return iconv.encode(content, enc);
        } catch (error) {
            diagnostic?.("encode", enc, error);
            return Buffer.from(content, "utf-8");
        }
    }
}
