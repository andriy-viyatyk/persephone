/** Serializable action metadata accepted from a site extension. */
export type SiteActionIcon = "play" | "file-text" | "image" | "table" | "link";

export interface SiteActionItem {
    id: string;
    label: string;
    icon?: SiteActionIcon;
    children?: SiteActionItem[];
}

export interface SiteActionDefinition {
    id: string;
    label: string;
    icon?: SiteActionIcon;
    children?: SiteActionDefinition[];
    run?: () => unknown;
}

const icons = new Set<unknown>(["play", "file-text", "image", "table", "link"]);
const controls = /[\p{Cc}\p{Cs}]/u;

/** Validate the complete tree before exposing any of its handlers or metadata. */
export function validateSiteActions(value: unknown, withHandlers: boolean): {
    items: SiteActionItem[];
    handlers: Map<string, () => unknown>;
} {
    const ids = new Set<string>();
    const handlers = new Map<string, () => unknown>();
    let count = 0;
    const visit = (input: unknown, depth: number): SiteActionItem[] => {
        if (!Array.isArray(input) || depth > 3 || input.length > 50
            || Object.keys(input).length !== input.length) throw new Error("Invalid action tree");
        return input.map((entry: unknown) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid action");
            const node = entry as Record<string, unknown>;
            if (Object.keys(node).some(key => !["id", "label", "icon", "children", ...(withHandlers ? ["run"] : [])].includes(key))) throw new Error("Unknown action property");
            if (++count > 50 || typeof node.id !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(node.id) || ids.has(node.id)) throw new Error("Invalid action id");
            ids.add(node.id);
            if (typeof node.label !== "string" || node.label.length < 1 || node.label.length > 240 || Array.from(node.label).length > 120 || controls.test(node.label)) throw new Error("Invalid action label");
            if (node.icon !== undefined && !icons.has(node.icon)) throw new Error("Invalid action icon");
            if (node.children !== undefined && !Array.isArray(node.children)) throw new Error("Invalid action children");
            const hasChildren = Array.isArray(node.children) && node.children.length > 0;
            if (withHandlers && (hasChildren ? node.run !== undefined : typeof node.run !== "function")) throw new Error("Invalid action handler");
            if (withHandlers && !hasChildren) handlers.set(node.id, node.run as () => unknown);
            return {
                id: node.id,
                label: node.label,
                ...(node.icon !== undefined ? { icon: node.icon as SiteActionIcon } : {}),
                ...(hasChildren ? { children: visit(node.children, depth + 1) } : {}),
            };
        });
    };
    return { items: visit(value, 1), handlers };
}
