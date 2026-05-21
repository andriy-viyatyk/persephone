import type { MonacoEditor } from "../../editors/monaco/MonacoEditor";

/**
 * Safe facade around MonacoEditor for script access.
 * Implements the ITextEditor interface from api/types/text-editor.d.ts.
 *
 * EPIC-028 / US-551 (SF6) — view-context query methods are async and route
 * through the editor's ComponentQueue. Fire-and-forget commands stay sync;
 * the queue drains them once Monaco mounts. Script authors must `await` the
 * query methods (breaking change vs. the legacy sync TextViewModel facade).
 */
export class TextEditorFacade {
    constructor(private readonly editor: MonacoEditor) {}

    /** True once the editor model exists. Queue-backed commands no longer
     *  require gating on this — the queue defers commands until mount. */
    get editorMounted(): boolean {
        return true;
    }

    // ── Fire-and-forget commands (sync — queued until view mounts) ──────

    revealLine(lineNumber: number): void {
        this.editor.revealLine(lineNumber);
    }

    setHighlightText(text?: string): void {
        this.editor.setHighlightText(text);
    }

    // ── View-context queries (async — queue.execute returns a Promise) ──

    async getSelectedText(): Promise<string> {
        return this.editor.getSelectedText();
    }

    async getCursorPosition(): Promise<{ lineNumber: number; column: number }> {
        return this.editor.getCursorPosition();
    }

    async insertText(text: string): Promise<void> {
        await this.editor.insertText(text);
    }

    async replaceSelection(text: string): Promise<void> {
        await this.editor.replaceSelection(text);
    }
}
