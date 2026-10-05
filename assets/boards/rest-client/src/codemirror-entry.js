export { EditorState } from "@codemirror/state";
export { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from "@codemirror/view";
export { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
export { bracketMatching, foldGutter, foldKeymap, indentUnit, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
export { tags } from "@lezer/highlight";
export { json } from "@codemirror/lang-json";
export { xml } from "@codemirror/lang-xml";
export { html } from "@codemirror/lang-html";
export { javascript } from "@codemirror/lang-javascript";
export { css } from "@codemirror/lang-css";
export { yaml } from "@codemirror/lang-yaml";
export { searchKeymap, openSearchPanel } from "@codemirror/search";

import { EditorView, lineNumbers, highlightActiveLineGutter, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentUnit, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { searchKeymap } from "@codemirror/search";

/** Syntax colours from the board's semantic `--p-*` palette, so highlighting follows the live
 *  Persephone theme. The palette has no dedicated syntax tokens; these are the closest roles. */
export const persephoneHighlightStyle = HighlightStyle.define([
    { tag: [tags.keyword, tags.tagName, tags.propertyName], color: "var(--p-accent)" },
    { tag: [tags.string, tags.special(tags.string)], color: "var(--p-success)" },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--p-warning)" },
    { tag: [tags.attributeName, tags.typeName, tags.className], color: "var(--p-link)" },
    { tag: [tags.comment, tags.meta], color: "var(--p-text-muted)", fontStyle: "italic" },
    { tag: tags.invalid, color: "var(--p-error)" },
]);

export const basicSetup = [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    foldGutter(),
    indentUnit.of("    "),
    bracketMatching(),
    syntaxHighlighting(persephoneHighlightStyle),
    keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap, indentWithTab]),
];
