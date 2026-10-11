/** Bounded source-panel snapshot passed to a board when a source is opened. */
export interface BoardSourceContext {
    kind: "folder" | "link-category" | "link-tag";
    sourcePath: string;
    category?: string;
    tag?: string;
    label: string;
    items: Array<{
        href: string;
        title: string;
        id?: string;
        category?: string;
        tags?: string[];
    }>;
    index: number;
}
