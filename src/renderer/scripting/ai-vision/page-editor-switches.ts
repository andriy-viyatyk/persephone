import type { IPageHost } from "../../api/pages/IPageHost";
import { getEditorSwitchOptions } from "../../editors/base/editor-switch-options";
import { createElements } from "ai-vision/dom";
import { activatePageAndWaitForLayout, pageScopeSelector } from "./page-elements";
import { ui } from "../../api/ui";
import type {
    IAiElementDeclaration,
    IAiMember,
    IAiVisible,
    IAiVisionDescriptor,
} from "ai-vision";
import type { IEditorSwitchOption } from "../../api/types/page-editor-switches";

const SWITCH_ELEMENTS: readonly IAiElementDeclaration[] = [
    { name: "page-editor-switch", purpose: "The page toolbar's editor switch control.", selector: '[data-name="page-editor-switch"]', where: "last control on a TextChromeView/PageToolbarView toolbar; Board places its embedded switch after its custom controls" },
];

const SWITCH_MEMBERS: readonly IAiMember[] = [
    { name: "current", kind: "property", summary: "The current main editor id." },
    { name: "options", kind: "property", summary: "The editor switch candidates shown by the page toolbar, including board and install entries." },
    { name: "switchTo", kind: "method", signature: "switchTo(id: string): Promise<void>", summary: "Switch to any registered editor id, not only an id listed in options.", caution: "changes the page editor; after awaiting, the switch is verified and a normal-return/no-switch result names the likely release-prompt or missing-file cause" },
];

export class PageEditorSwitchesNode implements IAiVisible {
    constructor(private readonly hostProvider: () => IPageHost | null) {}

    private get host(): IPageHost | null {
        return this.hostProvider();
    }

    private get mainEditor() {
        return this.host?.mainEditorInstance ?? null;
    }

    /** Empty when the page has no editor at all (a tab left open after its editor was closed,
     *  US-1408). Reporting "monaco" there would contradict `page.editor`, which reports no
     *  editor, and would invite a switchTo() against a page with nothing to rebuild over. */
    get current(): string {
        const host = this.host;
        if (host && !host.mainEditorInstance && !host.mainEditor) return "";
        return this.mainEditor?.editorId
            ?? (host?.mainEditor?.state.get() as { editor?: string } | undefined)?.editor
            ?? "monaco";
    }

    get options(): readonly IEditorSwitchOption[] {
        const editor = this.mainEditor;
        return editor ? getEditorSwitchOptions(editor) : [];
    }

    async switchTo(id: string): Promise<void> {
        if (this.current === id) return;
        const host = this.host;
        if (!host?.switchMainEditor) throw new Error("Page is no longer attached.");

        await host.switchMainEditor(id);
        if (host.mainEditorInstance?.editorId !== id) {
            throw new Error(
                `Editor switch to "${id}" did not complete. The release prompt may have been declined, or the page may have no file to rebuild over.`,
            );
        }
    }

    get aiVision(): IAiVisionDescriptor {
        const host = this.host;
        const elements = createElements(SWITCH_ELEMENTS, ui.highlightElement.bind(ui), {
            scopeSelector: host ? pageScopeSelector(host.id) : undefined,
            beforeHighlight: host ? () => activatePageAndWaitForLayout(host.id) : undefined,
        });
        return {
            kind: "PageEditorSwitches",
            summary: "The current page's editor switch state and toolbar candidates.",
            members: [...SWITCH_MEMBERS, ...elements.members],
            provide: elements.provide,
            elements: SWITCH_ELEMENTS,
            help: "current is the page's main editor id, or empty when the page has no editor (a tab left open after its editor was closed) — options is then empty too, and pages.navigatePageTo is what gives the tab content again. options is the exact merged candidate list shown by the toolbar, including compatible editors, trusted board matches, and the install entry. switchTo(id) accepts any registered editor id rather than being limited to options; it awaits the switch and verifies mainEditorInstance.editorId. A same-id call is a silent no-op. If the switch returns without changing the id, the release prompt may have been declined or the page may have no file to rebuild over. Unknown ids preserve the registry's rejection.",
            summarize: () => ({ kind: "PageEditorSwitches", current: this.current, options: this.options }),
        };
    }
}
