import { errMessage } from "../../shared/utils";
import type {
    CapabilityId,
    CapabilityPageResult,
    ContentRepresentation,
    DiagramEditPayload,
    DiagramEditResult,
    ICapabilities,
    ImageEditPayload,
} from "./types/capabilities";
import { editorRegistry, type EditorCapabilityDeclaration } from "../editors/base/editorRegistry";
import type { EditorView } from "../../shared/types";

type CapabilityResult = CapabilityPageResult | DiagramEditResult;
type CapabilityHandler = (payload: unknown) => Promise<CapabilityResult>;

const handlers = new Map<string, CapabilityHandler>();

function capabilityKey(id: CapabilityId, representation?: ContentRepresentation): string {
    return `${id}:${representation ?? ""}`;
}

function reportDuplicate(id: CapabilityId, representation: ContentRepresentation | undefined): void {
    const name = representation ? `${id}/${representation}` : id;
    void import("./ui")
        .then(({ ui }) => ui.notify(
            `Duplicate capability registration: "${name}". The first registration remains active.`,
            "error",
        ))
        .catch((error: unknown) => {
            console.error(`Failed to report duplicate capability registration: ${errMessage(error)}`);
        });
}

function asRecord(payload: unknown, capability: CapabilityId): Record<string, unknown> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new TypeError(`${capability} expects an object payload.`);
    }
    return payload as Record<string, unknown>;
}

function requiredString(
    payload: Record<string, unknown>,
    key: string,
    capability: CapabilityId,
): string {
    const value = payload[key];
    if (typeof value !== "string") {
        throw new TypeError(`${capability} expects a string ${key}.`);
    }
    return value;
}

function createPageHandler(
    editorId: string,
    capability: CapabilityId,
    representation?: ContentRepresentation,
): CapabilityHandler {
    return async (payload: unknown): Promise<CapabilityPageResult> => {
        const values = asRecord(payload, capability);
        const content = requiredString(values, "content", capability);
        const language = requiredString(values, "language", capability);
        const title = requiredString(values, "title", capability);
        if (capability === "content.view" && values.representation !== representation) {
            throw new TypeError(
                `content.view expects representation "${representation}" for this handler.`,
            );
        }

        const { pagesModel } = await import("./pages");
        const page = pagesModel.addEditorPage(editorId as EditorView, language, title, content);
        return { pageId: page.id };
    };
}

function createDrawHandler(
    id: "image.edit" | "diagram.edit",
): CapabilityHandler {
    return async (payload: unknown): Promise<CapabilityResult> => {
        const { imageEdit, diagramEdit } = await import("../editors/draw/capability-handlers");
        if (id === "image.edit") return imageEdit(payload as ImageEditPayload);
        return diagramEdit(payload as DiagramEditPayload);
    };
}

function createHandler(
    editorId: string,
    declaration: EditorCapabilityDeclaration,
): CapabilityHandler {
    if (editorId === "draw-view") {
        return createDrawHandler(declaration.id as "image.edit" | "diagram.edit");
    }
    return createPageHandler(editorId, declaration.id, declaration.representation);
}

function seedCapabilities(): void {
    for (const definition of editorRegistry.getAll()) {
        for (const declaration of definition.capabilities ?? []) {
            const key = capabilityKey(declaration.id, declaration.representation);
            if (handlers.has(key)) {
                reportDuplicate(declaration.id, declaration.representation);
                continue;
            }
            handlers.set(key, createHandler(definition.id, declaration));
        }
    }
}

class Capabilities implements ICapabilities {
    invoke(id: "text.open", payload: { content: string; language: string; title: string }): Promise<CapabilityPageResult>;
    invoke(id: "content.view", payload: { representation: ContentRepresentation; content: string; language: string; title: string }): Promise<CapabilityPageResult>;
    invoke(id: "image.edit", payload: ImageEditPayload): Promise<CapabilityPageResult>;
    invoke(id: "diagram.edit", payload: { source: string; title: string }): Promise<DiagramEditResult>;
    async invoke(id: CapabilityId, payload: unknown): Promise<CapabilityResult> {
        const values = id === "content.view" ? asRecord(payload, id) : undefined;
        const representation = values?.representation;
        if (id === "content.view" && typeof representation !== "string") {
            throw new TypeError("content.view expects a string representation.");
        }
        const handler = handlers.get(capabilityKey(id, representation as ContentRepresentation | undefined));
        if (!handler) throw new Error(`Unknown capability: ${id}`);
        return handler(payload);
    }
}

seedCapabilities();

export const capabilities = new Capabilities();
