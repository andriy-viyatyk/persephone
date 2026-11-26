persephone.service.onRequest((message) => {
    if (message?.op !== "local-app-data") {
        throw new Error("Unsupported fixture service operation.");
    }
    return { localAppData: process.env.LOCALAPPDATA ?? null, home: process.env.HOME ?? null };
});
