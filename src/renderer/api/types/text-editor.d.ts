/**
 * ITextEditor — Monaco editor-specific features.
 *
 * Obtained via `await page.asText()`. Only available for text pages.
 *
 * Methods that interact with the Monaco editor instance (insertText, replaceSelection,
 * getCursorPosition, getSelectedText) require the editor to be visible. Check
 * `editorMounted` before calling them.
 *
 * @example
 * const text = await page.asText();
 * if (text.editorMounted) {
 *     const selected = text.getSelectedText();
 *     text.replaceSelection(selected.toUpperCase());
 * }
 */
export interface ITextEditor {
    /** True when the Monaco editor is visible and mounted. */
    readonly editorMounted: boolean;

    /** Get currently selected text, or empty string if no selection. */
    getSelectedText(): string;

    /** Scroll to reveal a specific line in the center of the editor. */
    revealLine(lineNumber: number): void;

    /** Highlight all occurrences of text with find-match decorations. */
    setHighlightText(text: string): void;

    /** Get current cursor position. Returns {lineNumber: 1, column: 1} if editor is not mounted. */
    getCursorPosition(): { lineNumber: number; column: number };

    /** Insert text at current cursor position. No-op if editor is not mounted. */
    insertText(text: string): void;

    /** Replace current selection with text. No-op if editor is not mounted. */
    replaceSelection(text: string): void;
}
