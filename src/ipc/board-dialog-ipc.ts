export const BoardDialogChannel = {
    changed: "board-dialog:changed",
    list: "board-dialog:list",
    answer: "board-dialog:answer",
} as const;

export interface BoardDialogRecord {
    id: string;
    key: string;
    title: string;
    pageId: string;
    type: "alert" | "confirm" | "prompt";
    message: string;
    defaultPrompt: string;
    url: string;
    disposition: "pending" | "accepted" | "dismissed";
    timestamp: number;
}
