import type { IBaseEvent } from "./events";
import type { IContentPipe } from "./io.pipe";

/** Describes the link that opened a page — origin identity + metadata. */
export interface ISourceLink {
    /** Resolved URL (file path, HTTP URL, archive path). */
    readonly url: string;
    /** Target editor that was requested (if any). */
    readonly target?: string;
    /** Accumulated metadata from the link pipeline (excluding ephemeral fields). */
    readonly metadata?: Record<string, unknown>;
}

/** Metadata passed through the link pipeline. */
export interface ILinkMetadata {
    /** Open in this specific page instead of a new tab. */
    pageId?: string;
    /** Scroll to this line after opening. */
    revealLine?: number;
    /** Highlight occurrences of this text after opening. */
    highlightText?: string;
    /** HTTP headers (from cURL parser, etc.). */
    headers?: Record<string, string>;
    /** HTTP method (from cURL parser). */
    method?: string;
    /** HTTP body (from cURL parser). */
    body?: string;
    /** Additional custom data (for script/extension use). */
    [key: string]: unknown;
}

/** Layer 1: Raw link string to be parsed. */
export interface IRawLinkEvent extends IBaseEvent {
    /** The raw link string (file path, URL, cURL, etc.). */
    readonly raw: string;
    /** Target editor ID — passed through to Layer 2 if provided. */
    target?: string;
    /** Metadata — passed through to Layer 2 (e.g., pageId for navigation). */
    metadata?: ILinkMetadata;
}

/** Layer 2: Structured link to be resolved into provider + transformers. */
export interface IOpenLinkEvent extends IBaseEvent {
    /** Normalized URL (file path, https://, archive path, etc.). */
    readonly url: string;
    /** Target editor ID — optional, auto-resolved by handler if omitted. */
    target?: string;
    /** Open hints and pass-through metadata. */
    metadata?: ILinkMetadata;
}

/** Layer 3: Content pipe + target to be opened in an editor. */
export interface IOpenContentEvent extends IBaseEvent {
    /** Assembled content pipe (provider + transformers). */
    readonly pipe: IContentPipe;
    /** Resolved editor ID. */
    readonly target: string;
    /** Pass-through metadata (pageId, revealLine, etc.). */
    readonly metadata?: ILinkMetadata;
}
