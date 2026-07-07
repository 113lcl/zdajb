type UiSound = "click" | "success" | "danger";

let audioContext: AudioContext | null = null;
let muted = typeof window !== "undefined" && window.localStorage.getItem("ui-sound-muted") === "true";

function getAudioContext() {
  audioContext ??= new AudioContext();
  return audioContext;
}

export function playUiSound(type: UiSound = "click") {
  if (typeof window === "undefined" || muted) return;
  const context = getAudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  const frequency = type === "success" ? 740 : type === "danger" ? 180 : 420;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(type === "success" ? 920 : frequency * 1.12, now + 0.08);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(type === "danger" ? 0.045 : 0.035, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.12);
}

export function getUiSoundMuted() {
  return muted;
}

export function setUiSoundMuted(nextMuted: boolean) {
  muted = nextMuted;
  if (typeof window !== "undefined") {
    window.localStorage.setItem("ui-sound-muted", String(nextMuted));
  }
}
