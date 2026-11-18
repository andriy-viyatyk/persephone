const audioPromise = window.persephone.getCapability("audio", { version: 1 });
const captures = new Map();
const playbacks = new Set();
const leases = new Set();
let sequence = 0;

function summarize(chunks) {
  const epochs = chunks.map((chunk) => chunk.epoch);
  const times = chunks.map((chunk) => chunk.timeMs);
  const sizes = chunks.map((chunk) => chunk.data.byteLength);
  const sampleRates = chunks.map((chunk) => chunk.sampleRate);
  let sumSquares = 0;
  let samples = 0;
  for (const chunk of chunks) {
    const pcm = new Int16Array(chunk.data);
    for (const sample of pcm) {
      const normalized = sample / 32768;
      sumSquares += normalized * normalized;
      samples += 1;
    }
  }
  return {
    count: chunks.length,
    sizes,
    sampleRates,
    epoch: epochs[0] ?? null,
    validEpoch: Number.isInteger(epochs[0]),
    oneEpoch: epochs.every((epoch) => epoch === epochs[0]),
    increasingTime: times.every((time, index) => index === 0 || time > times[index - 1]),
    rms: samples ? Math.sqrt(sumSquares / samples) : 0,
  };
}

async function openCapture(options = {}) {
  const audio = await audioPromise;
  const channel = await audio.capture(options);
  const id = `capture-${++sequence}`;
  const state = { channel, chunks: [], waiters: [], error: null };
  channel.onMessage((message) => {
    if (message?.type !== "chunk") return;
    const waiter = state.waiters.shift();
    if (waiter) waiter.resolve(message);
    else if (state.chunks.length < 32) state.chunks.push(message);
  });
  channel.onClose((error) => {
    state.error = Object.assign(new Error(error.message), { code: error.code });
    for (const waiter of state.waiters.splice(0)) waiter.reject(state.error);
  });
  captures.set(id, state);
  return id;
}

function readCapture(id, count = 3) {
  const state = captures.get(id);
  if (!state) throw new Error(`Unknown capture ${id}`);
  return (async () => {
    const chunks = [];
    while (chunks.length < count) {
      if (state.chunks.length) chunks.push(state.chunks.shift());
      else if (state.error) throw state.error;
      else chunks.push(await new Promise((resolve, reject) => state.waiters.push({ resolve, reject })));
    }
    return summarize(chunks);
  })();
}

function closeCapture(id) {
  const state = captures.get(id);
  captures.delete(id);
  state?.channel.close();
}

async function invalidCapture(options) {
  try {
    const id = await openCapture(options);
    closeCapture(id);
    return null;
  } catch (error) {
    return error.code ?? "unknown";
  }
}

async function play(status) {
  const audio = await audioPromise;
  const channel = await audio.play({ sampleRate: 16000 });
  playbacks.add(channel);
  return new Promise((resolve, reject) => {
    const removeClose = channel.onClose((error) => {
      playbacks.delete(channel);
      reject(Object.assign(new Error(error.message), { code: error.code }));
    });
    channel.onMessage((message) => {
      if (message?.type !== "ended") return;
      removeClose();
      playbacks.delete(channel);
      resolve({ type: message.type, status: message.status, epoch: message.epoch });
    });
    const samples = new Float32Array(1600);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.sin(2 * Math.PI * 440 * index / 16000) * 0.15;
    }
    channel.send({ type: "chunk", data: samples.buffer });
    channel.send({ type: status });
  });
}

async function invalidPlayback(openOptions, payload) {
  const audio = await audioPromise;
  // ArrayBuffers cannot cross `call`; tests pass the bytes as a plain array.
  if (Array.isArray(payload?.bytes)) payload = { type: payload.type, data: new Uint8Array(payload.bytes).buffer };
  try {
    const channel = await audio.play(openOptions);
    playbacks.add(channel);
    return await new Promise((resolve) => {
      channel.onClose((error) => {
        playbacks.delete(channel);
        resolve(error.code ?? "unknown");
      });
      channel.send(payload);
    });
  } catch (error) {
    return error.code ?? "unknown";
  }
}

async function openMuteLease() {
  const audio = await audioPromise;
  const lease = await audio.muteApp();
  leases.add(lease);
  return leases.size;
}

async function releaseMuteLease() {
  const lease = [...leases].at(-1);
  if (!lease) return;
  leases.delete(lease);
  await lease.release();
}

async function closeAll() {
  for (const state of captures.values()) state.channel.close();
  captures.clear();
  for (const channel of playbacks) channel.close();
  playbacks.clear();
  for (const lease of leases) await lease.release();
  leases.clear();
}

const model = {
  aiVision: {
    kind: "AudioFixture",
    summary: "Test-only audio capability consumer returning metadata summaries.",
    members: [
      { name: "devices", kind: "method", summary: "List audio input devices." },
      { name: "openCapture", kind: "method", summary: "Open and retain an audio capture channel." },
      { name: "readCapture", kind: "method", summary: "Read a bounded chunk summary without returning PCM." },
      { name: "closeCapture", kind: "method", summary: "Close one retained capture channel." },
      { name: "invalidCapture", kind: "method", summary: "Return the code from rejected capture options." },
      { name: "play", kind: "method", summary: "Play a generated buffer and return its ended status." },
      { name: "invalidPlayback", kind: "method", summary: "Return the code from invalid playback input." },
      { name: "openMuteLease", kind: "method", summary: "Acquire and retain a global mute lease." },
      { name: "releaseMuteLease", kind: "method", summary: "Release the newest retained mute lease." },
      { name: "closeAll", kind: "method", summary: "Close all retained channels and release all leases." },
    ],
  },
  async devices() { return (await audioPromise).devices(); },
  openCapture,
  readCapture,
  closeCapture,
  invalidCapture,
  play,
  invalidPlayback,
  openMuteLease,
  releaseMuteLease,
  closeAll,
};

window.persephone.aiVision.expose(model);
