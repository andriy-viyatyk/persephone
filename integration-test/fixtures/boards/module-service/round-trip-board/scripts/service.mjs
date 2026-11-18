const HANDLED_BY = "module-service-fixture";

persephone.service.onRequest((message) => {
    if (message?.op === "identity") return { pid: process.pid };
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
