import type { EditorModel } from "../../editors/base/EditorModel";
import { ui } from "../../api/ui";
import { createElements } from "ai-vision/dom";
import { activatePageAndWaitForLayout, pageScopeSelector } from "../ai-vision/page-elements";
import type { IAiElementDeclaration, IAiMember, IAiVisionDescriptor } from "ai-vision";
import { withEditorGuideHelp } from "./editor-guide-help";

export interface EditorFacadeDescription {
    kind: string;
    summary: string;
    members: readonly IAiMember[];
    identitySummaries?: { id: string; name: string };
    identityIndex?: number;
    help: string;
    elements?: readonly IAiElementDeclaration[] | (() => readonly IAiElementDeclaration[]);
    highlightOptions?: { all?: boolean };
    summarize?: IAiVisionDescriptor["summarize"];
    provide?: (elementProvide: NonNullable<IAiVisionDescriptor["provide"]>) => IAiVisionDescriptor["provide"];
    restricted?: IAiVisionDescriptor["restricted"];
}

/** Shared page identity, attachment validation, and AiVision descriptor assembly for editor facades. */
export abstract class EditorFacadeBase<TEditor extends EditorModel> {
    #attachedEditor?: TEditor | (() => TEditor | undefined);
    #ensureAttached?: () => void;

    protected constructor(readonly id: string, readonly name: string) {}

    protected setEditor(editor: TEditor | (() => TEditor | undefined), ensure?: () => void): void {
        this.#attachedEditor = editor;
        this.#ensureAttached = ensure;
    }

    protected get editorModel(): TEditor | undefined {
        return typeof this.#attachedEditor === "function" ? this.#attachedEditor() : this.#attachedEditor;
    }

    protected get pageId(): string | undefined {
        return this.editorModel?.page?.id;
    }

    protected requireAttached(action: string, message?: (action: string) => string): string {
        this.#ensureAttached?.();
        const pageId = this.pageId;
        if (!pageId) {
            throw new Error(message?.(action) ?? `${this.name} ${action} unavailable: no page host attached.`);
        }
        return pageId;
    }

    protected describeEditor(description: EditorFacadeDescription): IAiVisionDescriptor {
        const members = [...description.members];
        if (description.identitySummaries) {
            members.splice(description.identityIndex ?? 0, 0,
                { name: "id", kind: "property", summary: description.identitySummaries.id },
                { name: "name", kind: "property", summary: description.identitySummaries.name });
        }
        const declarations = typeof description.elements === "function"
            ? description.elements()
            : description.elements;
        let descriptorMembers = members;
        let elementDescriptor: Pick<IAiVisionDescriptor, "elements" | "provide"> = {};
        if (declarations) {
            const pageId = this.pageId;
            const elements = createElements(declarations, ui.highlightElement.bind(ui), {
                scopeSelector: pageId ? pageScopeSelector(pageId) : undefined,
                beforeHighlight: pageId ? () => activatePageAndWaitForLayout(pageId) : undefined,
                ...(description.highlightOptions ? { highlightOptions: description.highlightOptions } : {}),
            });
            descriptorMembers = [...members, ...elements.members];
            elementDescriptor = {
                elements: declarations,
                provide: description.provide ? description.provide(elements.provide) : elements.provide,
            };
        }
        const descriptor: IAiVisionDescriptor = {
            kind: description.kind,
            summary: description.summary,
            members: descriptorMembers,
            ...elementDescriptor,
            help: withEditorGuideHelp(this.id, description.help),
            ...(description.summarize ? { summarize: description.summarize } : {}),
            ...(description.restricted ? { restricted: description.restricted } : {}),
        };
        return descriptor;
    }
}
