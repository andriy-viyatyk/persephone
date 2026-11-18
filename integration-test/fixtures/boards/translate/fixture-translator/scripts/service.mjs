const FAILURE_SENTINEL = "Fixture translation failure sentinel";

function finish(channel, message) {
    channel.send(message);
    channel.close();
}

persephone.service.onChannel((channel, openMessage) => {
    if (openMessage?.type === "describe") {
        finish(channel, {
            type: "description",
            engine: "Offline Fixture",
            model: "Deterministic text",
            pairs: [
                { from: "es", to: "en", installed: true, sizeBytes: 0 },
                { from: "en", to: "es", installed: true, sizeBytes: 0 },
            ],
            features: ["detect", "html"],
        });
        return;
    }

    if (openMessage?.type === "detect") {
        finish(channel, {
            type: "detection",
            language: "es",
            confidence: "high",
            sampleChars: Array.from(openMessage.text ?? "").length,
            candidates: [{ language: "es", score: 1 }],
        });
        return;
    }

    if (openMessage?.type === "translate") {
        if (openMessage.items?.some((item) => item.text.includes(FAILURE_SENTINEL))) {
            finish(channel, { type: "error", code: "engine-failed", message: "Fixture translation failed." });
            return;
        }
        finish(channel, {
            type: "result",
            id: openMessage.id,
            items: openMessage.items.map((item) => ({
                key: item.key,
                ok: true,
                text: `Fixture translation: ${item.text}`,
            })),
        });
        return;
    }

    channel.close({ code: "unsupported-operation", message: "Unsupported fixture translation operation." });
});
