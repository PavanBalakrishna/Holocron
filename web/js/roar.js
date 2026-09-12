/**
 * HOLOCRON — Shyriiwook, synthesised.
 *
 * Chewbacca cannot be spoken by speechSynthesis. Every voice a device ships is
 * a human-language voice, so "Rrrwwwgg. Ahhnnrr" comes out as an English
 * speaker pronouncing nonsense syllables — the text read aloud rather than a
 * Wookiee. Pitch and rate cannot rescue it; the phonetics are wrong, not the
 * tuning.
 *
 * So he is not spoken at all. He is synthesised: a growl built from an
 * oscillator pair, filtered noise and an amplitude wobble, shaped by the text
 * rather than pronouncing it. Web Audio needs no assets, no network and no CSP
 * allowance, which keeps him working everywhere the rest of the page does.
 *
 * The anatomy of the sound, roughly:
 *   • a low sawtooth fundamental with a pitch arc — up into the roar, down out
 *   • a sub an octave below for chest
 *   • bandpassed white noise for the rasp in the throat
 *   • a 30-ish Hz tremolo, which is what makes it growl rather than hum
 *   • a lowpass over everything, because a Wookiee is not bright
 */

const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext ?? window.webkitAudioContext) : null;

export const canRoar = Boolean(AudioCtx);

let ctx = null;
let active = [];
let endTimers = new Set();

/**
 * When the queued roars finish, in context time.
 *
 * A reply arrives sentence by sentence and each one calls roar(), so these
 * must queue rather than replace one another — cutting the previous one off
 * also strands its completion callback, and the hands-free loop counts on
 * every roar reporting that it finished.
 */
let queueEndsAt = 0;

/**
 * Browsers start an AudioContext suspended until a user gesture. The voice
 * selector's change event is that gesture, same as it is for speech.
 */
export function unlockAudio() {
  if (!AudioCtx) return;
  ctx ??= new AudioCtx();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

/**
 * Seeds the growl structure from the text, so the same line has the same
 * shape — durations, pitches, spacing — every time. The noise layer is not
 * seeded and differs run to run, which is inaudible and not worth the buffer
 * regeneration it would cost to fix.
 */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** One shared noise buffer; regenerating it per growl is pure waste. */
let noiseBuffer = null;
function noise() {
  if (!noiseBuffer) {
    const len = ctx.sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  return src;
}

/**
 * Schedule one growl.
 *
 * @param {number} at    when to start, in context time
 * @param {number} dur   length in seconds
 * @param {number} f0    fundamental in Hz
 * @param {number} heat  0..1 — how angry. Raises pitch travel and rasp.
 */
function growl(at, dur, f0, heat, out) {
  const end = at + dur;

  // The pitch arc. A flat growl sounds like a machine; the rise and fall is
  // most of what reads as a voice.
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f0 * 0.78, at);
  osc.frequency.linearRampToValueAtTime(f0 * (1.05 + heat * 0.25), at + dur * 0.32);
  osc.frequency.linearRampToValueAtTime(f0 * 0.68, end);

  const sub = ctx.createOscillator();
  sub.type = 'triangle';
  sub.frequency.setValueAtTime(f0 * 0.5, at);
  sub.frequency.linearRampToValueAtTime(f0 * 0.38, end);

  const rasp = noise();
  const raspBand = ctx.createBiquadFilter();
  raspBand.type = 'bandpass';
  raspBand.frequency.setValueAtTime(520 + heat * 900, at);
  raspBand.frequency.linearRampToValueAtTime(380, end);
  raspBand.Q.value = 1.4;

  const raspGain = ctx.createGain();
  raspGain.gain.value = 0.18 + heat * 0.3;
  rasp.connect(raspBand).connect(raspGain);

  // The growl itself: amplitude wobble somewhere around vocal-fold roughness.
  const tremolo = ctx.createOscillator();
  tremolo.type = 'sine';
  tremolo.frequency.value = 24 + heat * 22;
  const tremoloDepth = ctx.createGain();
  tremoloDepth.gain.value = 0.3 + heat * 0.2;
  tremolo.connect(tremoloDepth);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(0.85, at + Math.min(0.09, dur * 0.25));
  env.gain.setValueAtTime(0.85, end - dur * 0.35);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  tremoloDepth.connect(env.gain);

  osc.connect(env);
  sub.connect(env);
  raspGain.connect(env);
  env.connect(out);

  for (const node of [osc, sub, rasp, tremolo]) {
    node.start(at);
    node.stop(end + 0.02);
    active.push(node);
  }
}

/**
 * Roar a line of Shyriiwook.
 *
 * The text shapes the sound without being pronounced: each token becomes one
 * growl whose length follows the token's length, capital letters and
 * exclamation marks raise the heat, and a trailing question mark lifts the
 * final pitch. Long roars in the transcript therefore sound long, and an angry
 * one sounds angry — which is the only way meaning survives when the words are
 * not words.
 */
export function roar(text, { onDone } = {}) {
  if (!AudioCtx) {
    onDone?.();
    return;
  }
  ctx ??= new AudioCtx();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const tokens = String(text).split(/[\s.,!?—-]+/).filter(Boolean).slice(0, 12);
  if (!tokens.length) {
    onDone?.();
    return;
  }

  const rand = rng(hash(text));
  const shouty = (text.match(/[A-Z!]/g) ?? []).length / Math.max(8, text.length);
  const heat = Math.min(1, 0.25 + shouty * 2.2);

  // One throat for the whole line, so the growls share a body.
  const throat = ctx.createBiquadFilter();
  throat.type = 'lowpass';
  throat.frequency.value = 1400 + heat * 900;
  throat.Q.value = 0.7;

  const master = ctx.createGain();
  master.gain.value = 0.32;

  // Three sources sum into each growl's envelope, and overlapping tails push
  // the total past full scale — measured at 1.36 before this, which clips
  // audibly and is unpleasantly loud. The compressor catches the peaks; the
  // lower master gain means it is shaping rather than fighting them.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;

  throat.connect(master).connect(limiter).connect(ctx.destination);
  active.push(throat, master, limiter);

  // Start after anything already queued, with a breath between lines.
  const start = Math.max(ctx.currentTime + 0.04, queueEndsAt + 0.16);
  let t = start;
  for (const token of tokens) {
    const dur = Math.min(1.5, 0.22 + token.length * 0.075 + rand() * 0.15);
    const f0 = 82 + rand() * 46 + (heat * 22);
    growl(t, dur, f0, heat, throat);
    t += dur + 0.05 + rand() * 0.09;
  }
  queueEndsAt = t;

  const timer = setTimeout(() => {
    endTimers.delete(timer);
    if (endTimers.size === 0) {
      active = [];
      queueEndsAt = 0;
    }
    onDone?.();
  }, (t - ctx.currentTime) * 1000 + 80);
  endTimers.add(timer);
}

export function stopRoar() {
  for (const timer of endTimers) clearTimeout(timer);
  endTimers.clear();
  queueEndsAt = 0;
  for (const node of active) {
    try {
      node.stop?.();
    } catch {
      /* already stopped */
    }
    try {
      node.disconnect();
    } catch {
      /* already disconnected */
    }
  }
  active = [];
}
