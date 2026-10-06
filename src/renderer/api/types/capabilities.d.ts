/** Capability ids provided by platform and trusted-board handlers. */
export type CapabilityId = string;

export type CapabilityOrigin = "platform" | "board" | "script";

export interface CapabilityInfo {
    readonly id: string;
    readonly version: number;
    readonly priority: number;
    /**
     * Which handler serves this candidate — a built-in editor id (`md-view`) for a
     * `platform` origin, or the board's handler key otherwise. Without it two candidates for the
     * same id are indistinguishable, which matters most for `content.view`: six built-in editors
     * register it and they differ only by this field.
     */
    readonly handlerKey: string;
    readonly origin: CapabilityOrigin;
    readonly representation?: string;
    readonly boardRoot?: string;
    readonly alwaysOpensNewPage?: boolean;
    readonly accepts?: readonly string[];
    readonly payloadSchema?: unknown;
    readonly title?: string;
    readonly headless?: boolean;
}

export interface CapabilityHandlerFilter {
    readonly mime?: string;
    readonly representation?: string;
}

export interface CapabilityInvokeOptions {
    readonly version?: number;
    readonly filter?: CapabilityHandlerFilter;
    readonly pageId?: string;
    readonly signal?: AbortSignal;
    readonly deadlineMs?: number;
}

/** Representations supported by the built-in content viewer capability. */
export type ContentRepresentation = "svg" | "html" | "markdown" | "mermaid" | "grid" | "log";

export interface TextOpenPayload {
    content: string;
    language: string;
    title: string;
}

export interface ContentViewPayload {
    representation: ContentRepresentation;
    content: string;
    language: string;
    title: string;
}

export interface ImageEditPayload {
    dataUrl: string;
    mimeType?: string;
    naturalWidth?: number;
    naturalHeight?: number;
    title: string;
}

export interface DiagramEditPayload {
    source: string;
    title: string;
}

/** Chromium's certificate chain for an HTTPS page, encoded as base64 DER leaf first. */
export interface CertificateViewPayload {
    title: string;
    certificates: string[];
    source?: { url: string };
}

export interface CapabilityPageResult {
    readonly pageId: string;
}

export type DiagramEditResult =
    | { readonly status: "opened"; readonly pageId: string; readonly imageOnly: boolean }
    | { readonly status: "conversion-failed"; readonly message: string };

/** Built-in capability lookup and invocation surface. */
export interface ICapabilities {
    invoke(id: "text.open", payload: TextOpenPayload): Promise<CapabilityPageResult>;
    invoke(id: "content.view", payload: ContentViewPayload): Promise<CapabilityPageResult>;
    invoke(id: "image.edit", payload: ImageEditPayload): Promise<CapabilityPageResult>;
    invoke(id: "diagram.edit", payload: DiagramEditPayload): Promise<DiagramEditResult>;
    invoke(id: "certificate.view", payload: CertificateViewPayload): Promise<unknown>;
    invoke(id: string, payload: unknown, opts?: CapabilityInvokeOptions): Promise<unknown>;
    list(): readonly CapabilityInfo[];
    handlers(id: string, filter?: CapabilityHandlerFilter): readonly CapabilityInfo[];
}
