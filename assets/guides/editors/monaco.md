---
title: "Text Editor"
audience: both
summary: "Monaco-powered text editing for code, plain text, scripts, and file content."
editorId: "monaco"
---

# Text Editor

Text Editor is the Monaco-powered default and fallback for text and unrecognized file content. It
provides syntax highlighting, IntelliSense, find/replace, multi-cursor editing, folding, minimap,
column selection, and `Ctrl+Y` line deletion. Markdown and HTML text pages also support converted
clipboard paste with `Ctrl+Shift+V`.

## How to Open

Open any text file or choose **Text Editor** from the page toolbar. It is the default for ordinary
text and the fallback when no specialized matcher accepts a file. Agents can create a content page
with `pages.addEditorPage("monaco", language, title, content)`.

## Layout

```
+---------------------------------------------------------------------+
| [Nav] [Compare] [Run] [Run all]      [Resources] [Mic] [Translate] [Wrap] [Switch] |  toolbar: script actions at left; resources, microphone, Translate (when a provider is available), Word Wrap, and switch at right
+---------------------------------------------------------------------+
| [Monaco editor]                                                     |  Monaco editing surface below the toolbar
+---------------------------------------------------------------------+
| [Script panel toggle]                                               |  footer: related script panel control when a script exists
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Compare → `text-compare-left`
- Run → `text-run-script`
- Run all → `text-run-all-script`
- Show Resources → `text-show-resources`
- Microphone / Transcript (when a provider is available) → `transcript-button`
- Translate (when a provider is available) → `translate-text-button`
- Word Wrap → `text-word-wrap-toggle`
- Show/Hide TypeScript errors (on a registered project `.ts`/`.tsx` page) → `text-ts-diagnostics-toggle`
- Script panel toggle → `text-toggle-script`
- Script panel splitter → `script-panel-splitter`
- Run script → `script-run`
- Run all → `script-run-all`
- Script selection → `script-select`
- Save → `script-save`
- Open in tab → `script-open-tab`
- Close → `script-close`
- Page navigation and Editor switch → no entry: shell-owned controls
- Monaco find/replace controls → no entry: generated Monaco editor internals

### When the related script panel is open

```
+---------------------------------------------------------------------+
| [Monaco editor] [Splitter]                         [Script panel]   |  open related-script surface beside the editor
+---------------------------------------------------------------------+
```

### When the Monaco find bar is open

```
+---------------------------------------------------------------------+
| [Monaco editor] [Find/replace widget]                               |  Monaco editor surface with its generated find/replace widget
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Page navigation and Editor switch — no entry: shell-owned controls are addressed by the shared chrome.
- Monaco find/replace widget and minimap — no entry: generated editor-internal controls.

### While a transcript is active

```
+---------------------------------------------------------------------+
| [Nav] [Compare] [Run] [Run all]      [Resources] [Stop] [Audio level] [Translate] [Wrap] [Switch] |  toolbar: active Transcript places Stop and audio level between Resources and Translate
+---------------------------------------------------------------------+
```

- Stop → `transcript-stop`
- Audio level → `transcript-level`

Transcript appears when a v1 Speech to Text provider is installed and trusted.

### On a registered TypeScript project page

```
+---------------------------------------------------------------------+
| [Nav] [Compare] [Run] [Run all]      [Resources] [Mic] [Translate] [Wrap] [TS errors] [Switch] |  toolbar: project TypeScript errors toggle appears beside Word Wrap
+---------------------------------------------------------------------+
```

When a board has registered a TypeScript project and the page edits a `.ts` or `.tsx` file under
that project, the toolbar adds **Show TypeScript errors** (or **Hide TypeScript errors** while
enabled), beside Word Wrap. The toggle shows project diagnostics for that page; see the
[Boards guide](../boards.md) for registration details.

## Word Wrap

Click **Word Wrap** in the Text Editor toolbar to wrap long lines on the current page. The choice
belongs to that page and persists when you switch editors, restart Persephone, or move the page to
another window. With line numbers enabled, hard newline rows retain gutter numbers while soft
wrapped continuation rows have blank gutters.

To choose the default for newly shown Text Editor pages, use **Settings -> Editor Behavior -> Enable
Word Wrap by default**. It is off by default. Changing this setting does not change existing pages;
each page keeps its own saved choice. The same action is available as **Toggle Word Wrap** in
Monaco's Command Palette (`Ctrl+Shift+P`) while a Text Editor is focused.

## Translate

Choose the Translate toolbar button, then **Translate selection** or **Translate page**. The
translation dialog detects the source language and lets you choose the source and target languages.
If the selected language models are missing, Persephone asks before downloading them and shows
download and translation progress. You can cancel the operation. The result opens in a new tab using
the same editor type; the original page is unchanged. Selection translation requires selected text.

Install and trust the **Translate** board from the board catalog to provide translation. The board
downloads language models as needed and can translate offline after the models are available.

## Transcript

Choose the microphone button in the right side of the toolbar, then select **Microphone (me)**,
**Computer audio**, or **Both**. Computer audio and Both are available on Windows. Install and
trust the Speech to Text board from Tools & Editors first; it must support live transcription.
The Speech to Text board processes audio locally. Computer audio captures sound played by the
computer, so use it for calls or videos. In Both mode, microphone text is labeled **Me** and
computer audio is labeled **Others**; use headphones to avoid hearing the computer audio again
through the microphone.

The toolbar shows the live audio level while recording. Choose **Stop** to finish capture and wait
for the provider's final response. Committed utterances are appended to the end of the text without
moving your current selection. Draft text is not shown or inserted. Closing the page or switching
its editor away from Text Editor stops the session. Only one Transcript or Voice Typing session can
run in an app window. See [Keyboard Shortcuts](../shortcuts.md#transcript) for more detail.

The microphone button opens the source menu while idle and becomes **Stop** while capturing audio.

## Compare Mode

Compare is a grouped-page mode, not a separate registry editor id. Open two files, `Ctrl`-click the
second tab to group them, then choose **Compare**. The Monaco diff view compares the pair side by side.

## Script Panel

The Script Panel runs JavaScript or TypeScript against the page content. Run a selection or the full
script, choose a script, save or open scripts, and direct output to a grouped page. See [Scripting](../scripting/index.md)
for the `page`, `app`, and `io` objects.

## Agent API

After narrowing `page.editor.id` to `monaco`, the Text Editor facade exposes the text-editor state
and script surface. `wordWrap` reports the page-local persisted state and `toggleWordWrap()` changes
it. Verified page elements include `text-compare-left`, `text-run-script`, `text-run-all-script`,
`text-show-resources`, `text-word-wrap-toggle`, `text-ts-diagnostics-toggle` (only on registered
project TypeScript pages), `text-toggle-script`, `script-panel-splitter`,
`script-run`, `script-run-all`, `script-select`, `script-save`, `script-open-tab`, and
`script-close`. Use [the page API](../scripting/api/page.md) for the facade members.

## Errors and limits

Binary content is not rendered as useful text; it produces a warning and should use the matching
viewer or a published board. Compare requires two grouped pages. Script errors are reported by the
script panel and do not change the source unless the script writes through the page API.
