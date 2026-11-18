persephone.capabilities.handle("speech.synthesize", "speak", async () => {
    const error = new Error("This fixture does not synthesize audio.");
    error.code = "rejected";
    throw error;
});

persephone.capabilities.handle("speech.synthesize", "stop", async () => null);
