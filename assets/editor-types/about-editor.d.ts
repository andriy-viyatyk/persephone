import type { IHighlightResult } from "./ui";

export type AboutGuideLocation =
    | { readonly kind: "contents" }
    | { readonly kind: "guide"; readonly path: string; readonly fragment?: string };

/** Script-facing facade for the About page's in-pane guide browser. */
export interface IAboutEditor {
    readonly id: "about-view";
    readonly name: string;
    readonly elements: readonly {
        readonly name: string;
        readonly purpose: string;
        readonly selector: string;
        readonly visible: boolean;
    }[];
    /** Highlight one curated About control by name. */
    highlight(name: string, message?: string): Promise<IHighlightResult>;
    /** Open a shipped guide in About's right pane without creating a tab. */
    open(path: string): Promise<void>;
    /** Return to the previous About pane location; throws when history is empty. */
    back(): Promise<void>;
    /** Current pane location, with fragment omitted when absent. */
    readonly current: AboutGuideLocation;
}
