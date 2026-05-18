/**
 * Short audible beep used as a non-blocking error/affordance cue.
 *
 * Uses the Web Audio API directly so it works without bundling an audio asset
 * and respects the browser's user-gesture autoplay policy (silently swallows
 * AudioContext creation failures when the page hasn't been interacted with yet).
 */
export function beep(): void {
    try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        const audioCtx = new Ctor();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.frequency.value = 440;
        oscillator.type = "sine";
        gainNode.gain.value = 0.3;

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.start();

        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
        oscillator.stop(audioCtx.currentTime + 0.2);
    } catch {
        // user-gesture autoplay policy can throw on first call; ignore.
    }
}
