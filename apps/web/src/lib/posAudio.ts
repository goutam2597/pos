/**
 * Till audio feedback.
 *
 * A cashier looks at the customer and the merchandise, not at the screen — the
 * same way a real register speaks in beeps. A scan that adds to the cart must
 * beep like a scan that added; a scan that found nothing must sound wrong, or
 * the cashier keeps scanning items that are not being rung up. Both sounds are
 * synthesised with WebAudio so the till makes no network request and nothing
 * to download.
 *
 * The AudioContext is created lazily: browsers refuse to make sound before a
 * user gesture, and the first keystroke or click is gesture enough.
 */

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(at: number, freq: number, duration: number, peak = 0.05): void {
  const ac = audioContext();
  if (!ac) return;
  try {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // Fast attack, exponential decay — reads as a beep, not a hum.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  } catch {
    // Sound is feedback, never a failure: a till with audio blocked must keep
    // selling.
  }
}

/** One short high beep — "item added". */
export function scanBeepOk(): void {
  const ac = audioContext();
  if (!ac) return;
  tone(ac.currentTime, 1500, 0.09);
}

/** Two low beeps — "scan not recognised". */
export function scanBeepError(): void {
  const ac = audioContext();
  if (!ac) return;
  const t = ac.currentTime;
  tone(t, 330, 0.11);
  tone(t + 0.17, 330, 0.11);
}
