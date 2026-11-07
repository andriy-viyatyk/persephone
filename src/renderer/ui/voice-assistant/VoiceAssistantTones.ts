export function playVoiceAssistantTone(rising: boolean): void {
    try {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime;
        oscillator.frequency.setValueAtTime(rising ? 660 : 880, start);
        oscillator.frequency.linearRampToValueAtTime(rising ? 880 : 660, start + 0.12);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.08, start + 0.01);
        gain.gain.setValueAtTime(0.08, start + 0.1);
        gain.gain.linearRampToValueAtTime(0, start + 0.12);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); void context.close(); };
        oscillator.start(start); oscillator.stop(start + 0.12);
    } catch { /* Audio feedback is optional. */ }
}
