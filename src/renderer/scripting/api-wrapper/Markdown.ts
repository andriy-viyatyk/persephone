import type { LogViewEditor } from "../../editors/log-view";
import type { StyledText, MarkdownOutputEntry } from "../../editors/log-view/logTypes";
import { app } from "../../api/app";
import { guard } from "../../core/utils/guard";

/**
 * Markdown helper returned by `ui.show.markdown()`.
 * Property setters update the underlying log entry.
 */
export class Markdown {
    private _text: string;
    private _title?: StyledText;

    constructor(
        private readonly entryId: string,
        private readonly vm: LogViewEditor,
        initial: { text: string; title?: StyledText },
    ) {
        this._text = initial.text;
        this._title = initial.title;
    }

    private update(): void {
        this.vm.updateEntryById(this.entryId, (draft) => {
            const d = draft as MarkdownOutputEntry;
            d.text = this._text;
            d.title = this._title;
        });
    }

    get text(): string { return this._text; }
    set text(value: string) { this._text = value; this.update(); }

    get title(): StyledText | undefined { return this._title; }
    set title(value: StyledText | undefined) { this._title = value; this.update(); }

    openInEditor(pageTitle?: string): void {
        const title = pageTitle ?? (typeof this._title === "string" ? this._title : "Markdown");
        void guard("Failed to open Markdown editor", () => app.capabilities.invoke("content.view", {
            representation: "markdown",
            content: this._text,
            language: "markdown",
            title,
        }));
    }
}
