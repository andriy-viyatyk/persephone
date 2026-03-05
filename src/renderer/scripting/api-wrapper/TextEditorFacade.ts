import type { TextViewModel } from "../../editors/text/TextEditor";

/**
 * Safe facade around TextViewModel for script access.
 * Implements the ITextEditor interface from api/types/text-editor.d.ts.
 */
export class TextEditorFacade {
    constructor(private readonly vm: TextViewModel) {}

    get editorMounted(): boolean {
        return this.vm.editorRef !== null;
    }

    getSelectedText(): string {
        return this.vm.getSelectedText();
    }

    revealLine(lineNumber: number): void {
        this.vm.revealLine(lineNumber);
    }

    setHighlightText(text: string): void {
        this.vm.setHighlightText(text);
    }

    getCursorPosition(): { lineNumber: number; column: number } {
        return this.vm.getCursorPosition();
    }

    insertText(text: string): void {
        this.vm.insertText(text);
    }

    replaceSelection(text: string): void {
        this.vm.replaceSelection(text);
    }
}
