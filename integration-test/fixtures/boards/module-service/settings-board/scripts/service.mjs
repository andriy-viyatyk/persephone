persephone.service.onRequest(async (message) => {
    if (message?.op !== "setting") throw new Error(`Unknown fixture operation: ${String(message?.op)}`);
    return await persephone.settings.get("mode");
});
