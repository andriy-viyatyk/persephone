import type { IContentPipe, IPipeDescriptor } from "./io.pipe";

/**
 * Unified link data descriptor.
 *
 * Flows through the entire `openRawLink → openLink → openContent` pipeline.
 * Created by the caller, enriched by each layer (parsers, resolvers, open handler),
 * and stored on the page as the source link.
 *
 * When subscribing to link pipeline events, the event IS an ILinkData:
 * @example
 * app.events.openRawLink.subscribe((data) => {
 *     console.log(data.href);    // raw input
 *     data.target = "browser";   // override target editor
 * });
 *
 * @example
 * // Open a link with full context
 * await app.events.openRawLink.sendAsync(io.createLinkData("https://example.com", {
 *     target: "browser",
 *     browserMode: "incognito",
 * }));
 */
export interface ILinkData {
    // ── Pipeline control ──────────────────────────────────────────
    /** Set to `true` to short-circuit the current channel's pipeline.
     *  Undefined is treated as `false`. */
    handled?: boolean;

    // ── Core identity ────────────────────────────────────────────
    /** Raw link string — file path, URL, cURL command, etc. Always set by callers via createLinkData(). */
    href?: string;
    /** Resolved URL after Layer 1 parsing (normalized path, extracted URL from cURL, etc.).
     *  If not set by a parser, open-handler uses `href` as fallback. */
    url?: string;

    // ── ILink-compatible fields (present when opened from an ILink) ──
    /** Unique identifier of the originating link item. */
    id?: string;
    /** Display title. */
    title?: string;
    /** Category path (using "/" separators). */
    category?: string;
    /** Metadata tags. */
    tags?: string[];
    /** Whether the originating item is a directory. */
    isDirectory?: boolean;
    /** Preview image URL. */
    imgSrc?: string;
    /** File size in bytes. */
    size?: number;
    /** Last modified time (ISO string). */
    mtime?: string;

    // ── Pipeline resolution (set by layers) ───────────────────────
    /** Target editor ID. Can be set by caller (from ILink.target), overridden by pipeline. */
    target?: string;
    /** Resolved pipe descriptor (set by Layer 2 resolvers). Persisted in page state. */
    pipeDescriptor?: IPipeDescriptor;
    /** Temporal pipe instance (set by Layer 2, consumed by Layer 3).
     *  NOT persisted — stripped before storage. */
    pipe?: IContentPipe;

    // ── Navigation hints (ephemeral — not persisted) ──────────────
    /** Open in this specific page instead of a new tab. */
    pageId?: string;
    /** Scroll to this line after opening. */
    revealLine?: number;
    /** Highlight occurrences of this text after opening. */
    highlightText?: string;

    // ── HTTP metadata (from cURL parser or callers) ───────────────
    /** HTTP headers. */
    headers?: Record<string, string>;
    /** HTTP method. */
    method?: string;
    /** HTTP body. */
    body?: string;

    // ── Browser routing (ephemeral — not persisted) ───────────────
    /** Browser routing mode ("os-default" | "internal" | "incognito" | "profile:<name>"). */
    browserMode?: string;
    /** Route URL to a specific browser page (add/navigate tab). */
    browserPageId?: string;
    /** How to open in the target browser page ("navigate" | "addTab"). */
    browserTabMode?: "navigate" | "addTab";

    // ── Content hints (ephemeral — not persisted) ─────────────────
    /** Fallback editor target when URL has no recognized extension. */
    fallbackTarget?: string;

    // ── Source tracking ───────────────────────────────────────────
    /** ID of the source editor/model that initiated this link opening.
     *  Used by ArchiveEditorModel to track provenance. */
    sourceId?: string;
}
