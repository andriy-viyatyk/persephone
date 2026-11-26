const HANDLED_BY = "module-service-fixture";
const ENVIRONMENT_KEYS = [
    "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
    "HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR",
    "CLAUDE_CONFIG_DIR", "CODEX_HOME", "PATH", "PATHEXT", "SystemRoot",
];

persephone.service.onRequest((message) => {
    if (message?.op === "identity") return { pid: process.pid };
    if (message?.op === "environment") return {
        boardData: process.env.PERSEPHONE_BOARD_DATA ?? null,
        environment: Object.fromEntries(ENVIRONMENT_KEYS.map((key) => [key, process.env[key] ?? null])),
    };
    if (message?.op !== "echo") throw new Error(`Unknown fixture operation: ${String(message?.op)}`);
    return { op: "echo", value: message.value, handledBy: HANDLED_BY };
});

persephone.service.onChannel((channel, openMessage) => {
    if (openMessage?.op !== "round-trip") {
        channel.close({ code: "rejected", message: "Unknown fixture channel operation." });
        return;
    }
    channel.onMessage((message) => {
        channel.send({ value: `fixture:${String(message?.value)}`, handledBy: HANDLED_BY });
    });
});
