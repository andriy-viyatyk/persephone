export const NODE_SCRIPT_MARKER = "--persephone-node-script";
export const NODE_SCRIPT_STDIN_KIND = "stdin";
export const NODE_SCRIPT_END_STDIN_KIND = "end-stdin";

export type NodeScriptHostMessage =
    | { kind: typeof NODE_SCRIPT_STDIN_KIND; data: string | Uint8Array }
    | { kind: typeof NODE_SCRIPT_END_STDIN_KIND };
