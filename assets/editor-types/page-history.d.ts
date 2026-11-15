/** One page-model navigation destination. Returned entries are fresh projections, not mutable model state. */
export interface IPageHistoryEntry {
    readonly title: string;
    /** Logical local path or virtual URL used to identify the destination. */
    readonly filePath: string;
    /** Editor type id used for the destination. */
    readonly target: string;
}

/** Page-wide Back and Forward stacks. Browser webview history is separate. */
export interface IPageHistory {
    readonly canGoBack: boolean;
    readonly canGoForward: boolean;
    /** Fresh copies of both oldest-first stacks; the last entry is the next destination. */
    readonly entries: {
        readonly back: readonly IPageHistoryEntry[];
        readonly forward: readonly IPageHistoryEntry[];
    };
    /** Navigate Back. Resolves true for a committed move, false for a normal no-op; actual errors reject. */
    back(): Promise<boolean>;
    /** Navigate Forward. Resolves true for a committed move, false for a normal no-op; actual errors reject. */
    forward(): Promise<boolean>;
}
