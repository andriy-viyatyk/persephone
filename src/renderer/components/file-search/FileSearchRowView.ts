import { createIconElement } from "../../uikit/shared/slots";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { createFileIconElement } from "../icons/icon-elements";
import type { SearchResultFileRow, SearchResultLineRow, SearchResultRow } from "./FileSearchModel";

interface FileSearchRowProps {
    row: SearchResultRow;
    onToggleExpanded(filePath: string): void;
}

/** Renders one FileSearch result directly on the RenderGrid wrapper that it adopts. */
export class FileSearchRowView extends VanillaView<FileSearchRowProps> {
    private rowKind: "file" | "line" | undefined;
    private chevronListenerCleanup: (() => void) | undefined;
    private chevron?: HTMLSpanElement;
    private fileIcon?: Element;
    private fileName?: HTMLSpanElement;
    private matchCount?: HTMLSpanElement;
    private lineNumber?: HTMLSpanElement;
    private lineText?: HTMLSpanElement;

    public constructor(wrapper: HTMLElement, props: FileSearchRowProps) {
        super(props, wrapper);
    }

    protected onMount(): void {
        this.renderRow(this.props.row);
    }

    protected onUpdate(props: FileSearchRowProps): void {
        this.renderRow(props.row);
    }

    private renderRow(row: SearchResultRow): void {
        if (row.type === "file") this.renderFileRow(row);
        else this.renderLineRow(row);
    }

    private renderFileRow(row: SearchResultFileRow): void {
        this.root.className = "fs-row fs-file-row";
        this.root.title = row.filePath;
        if (this.rowKind !== "file") {
            this.chevronListenerCleanup?.();
            this.root.replaceChildren();
            this.rowKind = "file";
            this.chevron = document.createElement("span");
            this.chevron.className = "fs-file-icon";
            this.chevronListenerCleanup = this.listen(this.chevron, "click", this.onChevronClick);
            this.fileName = document.createElement("span");
            this.fileName.className = "fs-file-name";
            this.matchCount = document.createElement("span");
            this.matchCount.className = "fs-match-count";
            this.root.append(this.chevron, this.fileName, this.matchCount);
        }

        const chevron = this.chevron;
        const fileName = this.fileName;
        const matchCount = this.matchCount;
        if (!chevron || !fileName || !matchCount) {
            throw new Error("FileSearch file row parts were not initialized");
        }
        chevron.replaceChildren(createIconElement(
            row.expanded ? "chevron-down" : "chevron-right",
            { width: 12, height: 12 },
        ));
        const icon = createFileIconElement({ path: row.filePath, width: 16, height: 16 });
        this.fileIcon?.replaceWith(icon);
        this.fileIcon = icon;
        chevron.after(icon);
        fileName.textContent = row.fileName;
        matchCount.textContent = String(row.matchedLinesCount);
    }

    private renderLineRow(row: SearchResultLineRow): void {
        this.root.className = "fs-row fs-line-row";
        this.root.removeAttribute("title");
        if (this.rowKind !== "line") {
            this.chevronListenerCleanup?.();
            this.chevronListenerCleanup = undefined;
            this.root.replaceChildren();
            this.rowKind = "line";
            this.chevron = undefined;
            this.fileIcon = undefined;
            this.fileName = undefined;
            this.matchCount = undefined;
            this.lineNumber = document.createElement("span");
            this.lineNumber.className = "fs-line-number";
            this.lineText = document.createElement("span");
            this.lineText.className = "fs-line-text";
            this.root.append(this.lineNumber, this.lineText);
        }
        const lineNumber = this.lineNumber;
        const lineText = this.lineText;
        if (!lineNumber || !lineText) {
            throw new Error("FileSearch line row parts were not initialized");
        }
        lineNumber.textContent = String(row.lineNumber);
        this.renderMatchText(lineText, row);
    }

    private readonly onChevronClick = (event: MouseEvent): void => {
        event.stopPropagation();
        const row = this.props.row;
        if (row.type === "file") this.props.onToggleExpanded(row.filePath);
    };

    /** Keep the FileSearch-specific ellipsis offset; highlightInto has different semantics. */
    private renderMatchText(host: HTMLSpanElement, row: SearchResultLineRow): void {
        const contextChars = 60;
        let displayText = row.lineText.trimStart();
        const trimmedChars = row.lineText.length - displayText.length;
        const adjustedStart = row.matchStart - trimmedChars;

        let startOffset = 0;
        if (adjustedStart > contextChars) {
            startOffset = adjustedStart - contextChars;
            displayText = "…" + displayText.substring(startOffset + 1);
        }

        const highlightStart = adjustedStart - startOffset + (startOffset > 0 ? 1 : 0);
        const before = displayText.substring(0, highlightStart);
        const match = displayText.substring(highlightStart, highlightStart + row.matchLength);
        const after = displayText.substring(highlightStart + row.matchLength);
        const highlight = document.createElement("span");
        highlight.className = "highlighted-text";
        highlight.textContent = match;
        host.replaceChildren(document.createTextNode(before), highlight, document.createTextNode(after));
    }
}
