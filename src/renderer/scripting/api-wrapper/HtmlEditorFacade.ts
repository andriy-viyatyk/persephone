import type { HtmlViewModel } from "../../editors/html/HtmlViewModel";

/**
 * Safe facade around HtmlViewModel for script access.
 * Implements the IHtmlEditor interface from api/types/html-editor.d.ts.
 *
 * - Minimal read-only facade for now
 * - Can be extended with copyToClipboard, saveToFile, etc.
 */
export class HtmlEditorFacade {
    constructor(private readonly vm: HtmlViewModel) {}

    get html(): string {
        return this.vm.pageModel.state.get().content;
    }
}
