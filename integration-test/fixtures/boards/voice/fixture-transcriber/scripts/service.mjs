const RESULT_TEXT = "hello from the fixture";

function acceptsCaller(info) {
    return info?.caller?.id === "persephone"
        && info.caller.name === "Persephone"
        && info?.interface?.id === "speech.transcribe"
        && info.interface.version === 1;
}

function isPcm16Mono16Khz(openMessage) {
    return openMessage?.format?.encoding === "pcm-s16le"
        && openMessage.format.sampleRate === 16000
        && openMessage.format.channels === 1;
}

persephone.service.onChannel((channel, openMessage, info) => {
    const earlyMessages = [];
    const stopCollecting = channel.onMessage((message) => earlyMessages.push(message));
    let closed = false;
    let terminalSent = false;
    let receivedAudioBytes = 0;
    let segmentSent = false;

    channel.onClose(() => { closed = true; });

    const sendTerminal = (message) => {
        if (closed || terminalSent) return;
        terminalSent = true;
        channel.send(message);
        channel.close();
    };

    if (!acceptsCaller(info)) {
        channel.close({ code: "connection-refused", message: "This fixture accepts Persephone speech transcription only." });
        return;
    }

    if (openMessage?.type === "describe") {
        channel.send({
            type: "description",
            engine: "Offline Fixture",
            model: "Fixed Text",
            languages: ["en"],
            local: true,
            maxAudioMs: 300000,
            features: ["live"],
        });
        channel.close();
        return;
    }

    if (openMessage?.type !== "transcribe" || !isPcm16Mono16Khz(openMessage)) {
        channel.close({ code: "unsupported-format", message: "Use mono PCM s16le at 16 kHz." });
        return;
    }

    channel.send({ type: "status", state: "listening" });

    const handleMessage = (message) => {
        if (closed || terminalSent || !message || typeof message !== "object") return;

        if (message.type === "audio") {
            if (!(message.data instanceof ArrayBuffer) || message.data.byteLength === 0 || message.data.byteLength % 2 !== 0) {
                sendTerminal({ type: "error", code: "unsupported-format", message: "Audio must be nonempty PCM s16le." });
                return;
            }
            receivedAudioBytes += message.data.byteLength;
            if (!segmentSent) {
                segmentSent = true;
                const audioMs = Math.round(receivedAudioBytes / 32);
                channel.send({
                    type: "segment",
                    utterance: "fixture-1",
                    text: RESULT_TEXT,
                    language: "en",
                    startMs: 0,
                    endMs: Math.max(1, audioMs),
                });
            }
            return;
        }

        if (message.type === "cancel") {
            sendTerminal({ type: "error", code: "cancelled", message: "Transcription cancelled." });
            return;
        }

        if (message.type === "end") {
            if (!receivedAudioBytes) {
                sendTerminal({ type: "error", code: "empty-audio", message: "The fixture received no audio." });
                return;
            }
            channel.send({ type: "status", state: "transcribing" });
            sendTerminal({
                type: "result",
                text: RESULT_TEXT,
                language: "en",
                audioMs: Math.round(receivedAudioBytes / 32),
                elapsedMs: 0,
            });
        }
    };

    stopCollecting();
    channel.onMessage(handleMessage);
    for (const message of earlyMessages) handleMessage(message);
});
