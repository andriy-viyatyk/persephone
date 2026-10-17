/** Serializable snapshot of the source panel that supplied a board open. */
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
        target?: string;
    }>;
    index: number;
}
