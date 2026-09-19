/** Capability ids provided by the built-in renderer handlers. */
export type CapabilityId = "text.open" | "content.view" | "image.edit" | "diagram.edit";

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
}
