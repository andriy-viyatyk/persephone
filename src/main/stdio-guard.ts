/**
 * Keeps a closed console from crashing the main process.
 *
 * When the process that started Persephone exits first (a dev server restart, a test runner that ended
 * while its instance stays open), stdout/stderr become broken pipes. The next `console.log` then throws
 * `EPIPE` from the stream's error event, which Electron reports as an uncaught main-process exception.
 * Console output is diagnostic only, so a write to a pipe nobody reads is dropped instead.
 */
export function guardStandardStreams(): void {
    for (const stream of [process.stdout, process.stderr]) {
        stream?.on("error", (error: NodeJS.ErrnoException) => {
            if (error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED") return;
            throw error;
        });
    }
}
