const providerPayload = new TextEncoder().encode("provider-payload");

persephone.providers.register("test/extensions", {
    writable: false,
    readBinary() {
        return providerPayload;
    },
});

persephone.capabilities.handle("test.extensions.echo", "echo", async ([value]) => ({
    value,
    handledBy: "extension-fixture",
}));

persephone.service.onRequest(async (request) => {
    if (request?.op !== "echo") throw new Error(`Unknown operation: ${String(request?.op)}`);
    return {
        op: "echo",
        value: request.value,
        handledBy: "extension-fixture",
    };
});
