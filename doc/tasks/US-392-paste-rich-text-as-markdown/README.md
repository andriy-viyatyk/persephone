# US-392: Paste Rich Text as Markdown in Monaco Editor

## Goal

When pasting clipboard content that contains rich text (HTML) into Monaco editor, show a popup dialog letting the user choose the paste format: **Plain text**, **Markdown**, or **HTML**.

## Background

When copying formatted text (e.g., from a chat, browser, or documentation), the system clipboard holds multiple formats simultaneously:
- `text/plain` — stripped plain text
- `text/html` — the HTML markup

Currently, Monaco always pastes the plain text version. This task adds an interception layer that detects rich clipboard content and offers format conversion.

### Relevant existing code

| What | File |
|------|------|
| TextViewModel (Monaco wrapper) | `src/renderer/editors/text/TextEditor.tsx` |
| TextFileModel (editor model) | `src/renderer/editors/text/TextEditorModel.ts` |
| TextEditorView (React mount) | `src/renderer/editors/text/TextEditorView.tsx` |
| Popup menu system | `src/renderer/ui/dialogs/poppers/showPopupMenu.tsx` |
| Popper infrastructure | `src/renderer/ui/dialogs/poppers/Poppers.tsx` |
| Clipboard in grid (pattern) | `src/renderer/components/data-grid/AVGrid/model/CopyPasteModel.ts` |
| REST client clipboard parse (pattern) | `src/renderer/editors/rest-client/parseClipboardRequest.ts` |

### Key patterns to follow

- **TextViewModel extensions**: `setupWheelZoom()` and `setupSelectionListener()` in `TextEditor.tsx` show the pattern — private setup methods called from `handleEditorDidMount`, with cleanup in `onDispose`.
- **Popup menus**: `showPopupMenu()` from `src/renderer/ui/dialogs/poppers/showPopupMenu.tsx` creates positioned popups with `MenuItem[]` items. Used in graph editor, REST client, and context menu model.
- **Electron clipboard**: With `nodeIntegration: true`, the renderer can use `require("electron").clipboard.readHTML()` directly. The DOM paste event also provides `e.clipboardData.getData("text/html")`.

## Implementation Plan

### 1. Install `turndown` package

```bash
npm install turndown
npm install -D @types/turndown
```

[turndown](https://github.com/mixmark-io/turndown) is a well-maintained HTML→Markdown converter (~20KB). Supports headings, bold/italic, links, lists, code blocks, images. Has a GFM plugin for tables and strikethrough.

Consider also installing `turndown-plugin-gfm` for GitHub-Flavored Markdown (tables, task lists, strikethrough).

### 2. Create paste format helper module

**New file:** `src/renderer/editors/text/pasteRichText.ts`

Responsibilities:
- Extract HTML from clipboard (via DOM `paste` event's `clipboardData`)
- Convert HTML → Markdown using Turndown
- Provide the three format options: plain, markdown, html
- Sanitize/clean the HTML before conversion (strip `<style>`, `<script>`, excessive whitespace)

```typescript
import TurndownService from "turndown";

const turndown = new TurndownService({
    headingStyle: "atx",       // # style headings
    codeBlockStyle: "fenced",  // ``` style code blocks
    bulletListMarker: "-",
});

export interface RichPasteFormats {
    plain: string;
    markdown: string;
    html: string;
}

export function extractRichPasteFormats(clipboardData: DataTransfer): RichPasteFormats | null {
    const html = clipboardData.getData("text/html");
    const plain = clipboardData.getData("text/plain");

    if (!html || !html.trim()) return null; // no rich content

    return {
        plain,
        markdown: turndown.turndown(html),
        html,
    };
}
```

### 3. Add paste interception to TextViewModel

**Modify:** `src/renderer/editors/text/TextEditor.tsx`

Add a new setup method following the existing pattern:

```typescript
// In TextViewModel class:
private pasteListenerCleanup: (() => void) | null = null;

setupRichPaste(editor: monaco.editor.IStandaloneCodeEditor) {
    const domNode = editor.getDomNode();
    if (!domNode) return;

    const handler = (e: ClipboardEvent) => {
        if (!e.clipboardData) return;
        const formats = extractRichPasteFormats(e.clipboardData);
        if (!formats) return; // no rich content, let default paste proceed

        e.preventDefault();
        e.stopPropagation();

        // Show popup at cursor position
        this.showPasteFormatPopup(editor, formats);
    };

    // Listen on the textarea inside Monaco (where paste actually fires)
    const textarea = domNode.querySelector("textarea.inputarea");
    const target = textarea || domNode;
    target.addEventListener("paste", handler as EventListener);

    this.pasteListenerCleanup = () => {
        target.removeEventListener("paste", handler as EventListener);
    };
}
```

Call from `handleEditorDidMount`:
```typescript
this.setupRichPaste(editor);
```

Clean up in `onDispose`:
```typescript
this.pasteListenerCleanup?.();
this.pasteListenerCleanup = null;
```

### 4. Show paste format popup

**Modify:** `src/renderer/editors/text/TextEditor.tsx` (or extract to helper)

```typescript
private showPasteFormatPopup(
    editor: monaco.editor.IStandaloneCodeEditor,
    formats: RichPasteFormats
) {
    // Get cursor screen position for popup placement
    const position = editor.getPosition();
    if (!position) {
        // Fallback: just paste plain
        this.insertText(editor, formats.plain);
        return;
    }

    const coords = editor.getScrolledVisiblePosition(position);
    const domNode = editor.getDomNode();
    if (!coords || !domNode) {
        this.insertText(editor, formats.plain);
        return;
    }

    const rect = domNode.getBoundingClientRect();
    const x = rect.left + coords.left;
    const y = rect.top + coords.top + coords.height;

    showPopupMenu(x, y, [
        { label: "Paste as Plain Text", onClick: () => this.insertText(editor, formats.plain) },
        { label: "Paste as Markdown",   onClick: () => this.insertText(editor, formats.markdown) },
        { label: "Paste as HTML",       onClick: () => this.insertText(editor, formats.html) },
    ]);
}

private insertText(editor: monaco.editor.IStandaloneCodeEditor, text: string) {
    editor.focus();
    // Use executeEdits to support undo
    const selection = editor.getSelection();
    if (selection) {
        editor.executeEdits("paste", [{
            range: selection,
            text,
            forceMoveMarkers: true,
        }]);
    }
}
```

### 5. Consider UX refinements

- **Escape/dismiss**: If popup is dismissed without choosing, paste nothing (or default to plain). Need to verify how `showPopupMenu` handles dismissal — may need an `onClose` callback that falls back to plain text paste.
- **Keyboard shortcuts**: Consider letting Enter default to plain, M for markdown, H for HTML.
- **Remember preference**: Optionally store last choice in settings and auto-apply next time (future enhancement, not for this task).
- **Language filter**: Consider only showing the popup for certain languages (markdown, plaintext) — for code files, always paste plain. This is a UX decision.

## Concerns / Open Questions

1. **Clipboard detection reliability**: Some applications put minimal HTML in clipboard even for plain text (e.g., `<meta charset="utf-8">text`). The detection logic should filter out "trivially wrapped" HTML that has no real formatting. May need a heuristic like: if the HTML stripped of tags equals the plain text, treat it as non-rich.

2. **Turndown quality**: The HTML→Markdown conversion is best-effort. Complex layouts (tables with merged cells, nested structures) may not convert perfectly. For typical chat/documentation content, it works well.

3. **Monaco paste interception**: The `paste` event fires on Monaco's internal textarea. Need to verify that `e.preventDefault()` fully blocks Monaco's default paste behavior. If not, may need to use Monaco's `onDidPaste` + undo approach, or override the paste command via `editor.addCommand`.

4. **Dynamic import**: Following the project's code-splitting philosophy, `turndown` should be dynamically imported only when rich paste is detected, not at module load time.

5. **Language filter scope**: Should the popup appear for ALL editor languages or only markdown/plaintext? If the user is editing `.js` and pastes rich text, do they want the popup? Probably not — but this is a UX decision for the user.

6. **showPopupMenu dismissal**: Need to check what happens when the popup is dismissed (click outside, Escape). The paste event was already prevented at that point, so the user would lose the paste. May need to paste plain text as fallback on dismiss.

## Acceptance Criteria

- [ ] Pasting rich text (HTML in clipboard) into Monaco shows a format chooser popup
- [ ] "Plain text" option pastes the same as current behavior
- [ ] "Markdown" option converts HTML to markdown and pastes it
- [ ] "HTML" option pastes the raw HTML markup
- [ ] Pasting plain-only clipboard content (no HTML) works normally with no popup
- [ ] The popup appears near the cursor position
- [ ] Undo (Ctrl+Z) works after paste
- [ ] No popup for non-rich clipboard content
- [ ] `turndown` is dynamically imported (not in main bundle)
