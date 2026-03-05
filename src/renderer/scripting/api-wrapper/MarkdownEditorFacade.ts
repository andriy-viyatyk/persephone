import type { MarkdownViewModel } from "../../editors/markdown/MarkdownViewModel";

/**
 * Safe facade around MarkdownViewModel for script access.
 * Implements the IMarkdownEditor interface from api/types/markdown-editor.d.ts.
 *
 * - `html` reads from the DOM container (rendered by react-markdown)
 * - `viewMounted` indicates whether the container is available
 */
export class MarkdownEditorFacade {
    constructor(private readonly vm: MarkdownViewModel) {}

    get viewMounted(): boolean {
        return this.vm.state.get().container !== null;
    }

    get html(): string {
        return this.vm.state.get().container?.innerHTML ?? "";
    }
}
