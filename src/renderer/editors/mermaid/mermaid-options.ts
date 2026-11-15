export type MermaidLook = "classic" | "neo" | "handDrawn";
export type MermaidLayout = "dagre" | "elk";

export interface MermaidRenderOptions {
    look: MermaidLook;
    layout: MermaidLayout;
}

export const DEFAULT_MERMAID_RENDER_OPTIONS: MermaidRenderOptions = {
    look: "classic",
    layout: "dagre",
};

export function isMermaidLook(value: unknown): value is MermaidLook {
    return value === "classic" || value === "neo" || value === "handDrawn";
}

export function isMermaidLayout(value: unknown): value is MermaidLayout {
    return value === "dagre" || value === "elk";
}
