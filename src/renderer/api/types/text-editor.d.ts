/**
 * ITextEditor — Monaco editor-specific features.
 *
 * Obtained via `await page.asText()`. Only available for text pages.
 *
 * EPIC-028 / US-551: view-context query methods (getSelectedText, getCursorPosition,
 * insertText, replaceSelection) are async — they go through the editor's
 * ComponentQueue and may queue briefly if Monaco hasn't mounted yet. Fire-and-forget
 * commands (revealLine, setHighlightText) stay sync — they queue if the view
 * isn't ready and drain on mount.
 *
 * @example
 * const text = await page.asText();
 * const selected = await text.getSelectedText();
 * await text.replaceSelection(selected.toUpperCase());
 */
export interface ITextEditor {
    /** True when the Monaco editor is visible and mounted. Under EPIC-028, the
     *  queue layer defers commands until mount, so this is informational —
     *  consumers no longer need to gate calls on it. */
    readonly editorMounted: boolean;

    /** Get currently selected text, or empty string if no selection. */
    getSelectedText(): Promise<string>;

    /** Scroll to reveal a specific line in the center of the editor. */
    revealLine(lineNumber: number): void;

    /** Highlight all occurrences of text with find-match decorations. */
    setHighlightText(text: string): void;

    /** Get current cursor position. Returns {lineNumber: 1, column: 1} if editor is not mounted. */
    getCursorPosition(): Promise<{ lineNumber: number; column: number }>;

    /** Insert text at current cursor position. */
    insertText(text: string): Promise<void>;

    /** Replace current selection with text. */
    replaceSelection(text: string): Promise<void>;
}
