import { t } from "../../../shared/i18n/t";
import type { EditorView } from "../../../shared/types";
import type { CapabilityId, CapabilityPageResult, ContentRepresentation } from "../types/capabilities";
import type { CapabilityRegistration } from "../../../ipc/capability-bus-channels";
import { editorRegistry, type EditorCapabilityDeclaration } from "../../editors/base/editorRegistry";
import { pagesModel } from "../pages";
import { ui } from "../ui";
import { payloadRecord, payloadString } from "./platform-payload-validators";

export type CapabilityHandler = (payload: unknown) => Promise<CapabilityPageResult>;

function capabilityKey(id: CapabilityId, representation?: string): string {
    return `${id}:${representation ?? ""}`;
}

function reportDuplicate(id: CapabilityId, representation: string | undefined): void {
    const name = representation ? `${id}/${representation}` : id;
    ui.notify(t("api.duplicateCapabilityRegistration", { name }), "error");
}

function createPageHandler(
    editorId: string,
    capability: CapabilityId,
    representation?: ContentRepresentation,
): CapabilityHandler {
    return async (payload: unknown): Promise<CapabilityPageResult> => {
        const values = payloadRecord(payload, capability);
        const content = payloadString(values, "content", capability);
        const language = payloadString(values, "language", capability);
        const title = payloadString(values, "title", capability);
        if (capability === "content.view" && values.representation !== representation) {
            throw new TypeError(
                `content.view expects representation "${representation}" for this handler.`,
            );
        }

        const page = pagesModel.addEditorPage(editorId as EditorView, language, title, content);
        return { pageId: page.id };
    };
}

function createHandler(
    editorId: string,
    declaration: EditorCapabilityDeclaration,
): CapabilityHandler {
    return createPageHandler(editorId, declaration.id, declaration.representation);
}

type HandlerTable = ReadonlyMap<string, ReadonlyMap<string, CapabilityHandler>>;

class BuiltinOpenHandlers {
    private table: HandlerTable | undefined;

    /** The editor-backed open handler for a platform registration. The table is built on first use. */
    resolve(registration: CapabilityRegistration): CapabilityHandler | undefined {
        return this.ensureTable()?.get(registration.handlerKey)?.get(capabilityKey(registration.id, registration.representation));
    }

    private ensureTable(): HandlerTable | undefined {
        if (this.table) return this.table;
        const definitions = editorRegistry.getAll();
        if (definitions.length === 0) return undefined;
        const table = new Map<string, Map<string, CapabilityHandler>>();
        for (const definition of definitions) {
            for (const declaration of definition.capabilities ?? []) {
                const key = capabilityKey(declaration.id, declaration.representation);
                const handlers = table.get(definition.id) ?? new Map<string, CapabilityHandler>();
                if (handlers.has(key)) {
                    reportDuplicate(declaration.id, declaration.representation);
                    continue;
                }
                handlers.set(key, createHandler(definition.id, declaration));
                table.set(definition.id, handlers);
            }
        }
        this.table = table;
        return table;
    }
}

export const builtinOpenHandlers = new BuiltinOpenHandlers();
