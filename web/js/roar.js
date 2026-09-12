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

import { hasSamples, playSample } from './samples.js';

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
 * Vowel formants, in Hz. F1/F2 are what the ear reads as a vowel; F3 adds the
 * vocal-tract body that separates a voice from a filtered buzz.
 *
 * This is the part that was missing. A Wookiee moan is not a low rumble — it
 * is a mouth opening and closing while a pitch glides underneath it, and that
 * "rrraaa-ooowww" shape is a formant sweep. A single lowpass cannot make it,
 * no matter how the fundamental is tuned.
 */
const VOWELS = {
  er: [490, 1350, 1690],
  aa: [730, 1090, 2440],
  ah: [640, 1190, 2390],
  oh: [450, 800, 2600],
  oo: [300, 870, 2240],
  uh: [500, 1000, 2400],
};

/** The shapes a Wookiee actually makes, as vowel journeys. */
const SHAPES = [
  ['er', 'aa', 'oo'],   // rrraaaooow — the signature
  ['oo', 'ah', 'oh'],   // a rising moan
  ['uh', 'er', 'ah'],   // a grumble
  ['aa', 'oh', 'oo'],   // a falling cry
  ['oh', 'aa'],         // a short bark
];

/**
 * Schedule one growl.
 *
 * @param {number} at    when to start, in context time
 * @param {number} dur   length in seconds
 * @param {number} f0    fundamental in Hz
 * @param {number} heat  0..1 — how angry. Widens the pitch travel and the rasp.
 * @param {string[]} shape  vowels to sweep through
 */
function growl(at, dur, f0, heat, shape, out) {
  const end = at + dur;

  // A voiced source needs harmonics for formants to have anything to shape.
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';

  // Wide pitch travel. A Wookiee cry rises hard into the middle and falls away;
  // a flat pitch is what made the previous version sound like machinery.
  osc.frequency.setValueAtTime(f0 * 0.72, at);
  osc.frequency.exponentialRampToValueAtTime(f0 * (1.5 + heat * 0.5), at + dur * 0.35);
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, end);

  // Jitter: a few Hz of wander. Real animals are not in tune with themselves,
  // and this is most of what separates "creature" from "synthesiser".
  const jitter = ctx.createOscillator();
  jitter.type = 'sine';
  jitter.frequency.value = 5.5 + Math.random() * 4;
  const jitterDepth = ctx.createGain();
  jitterDepth.gain.value = f0 * 0.05;
  jitter.connect(jitterDepth).connect(osc.frequency);

  // Breath through the same vocal tract as the voice.
  const breath = noise();
  const breathGain = ctx.createGain();
  breathGain.gain.value = 0.1 + heat * 0.16;
  breath.connect(breathGain);

  // Three formants in parallel, swept through the vowel journey. This is the
  // mouth moving.
  const bank = ctx.createGain();
  osc.connect(bank);
  breathGain.connect(bank);

  const sum = ctx.createGain();
  sum.gain.value = 1;

  const FORMANT_GAIN = [4.4, 2.6, 0.95];
  for (let i = 0; i < 3; i += 1) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 4.2 - i * 1.1;

    const step = dur / Math.max(1, shape.length - 1 || 1);
    bp.frequency.setValueAtTime(VOWELS[shape[0]][i], at);
    shape.forEach((v, k) => {
      if (k === 0) return;
      bp.frequency.exponentialRampToValueAtTime(VOWELS[v][i], at + step * k);
    });

    const g = ctx.createGain();
    g.gain.value = FORMANT_GAIN[i];
    bank.connect(bp).connect(g).connect(sum);
    active.push(bp, g);
  }

  // SUBHARMONICS — the actual anatomy of a growl. When vocal folds go rough
  // they period-double, producing energy at f0/2 and f0/3 that is not present
  // in ordinary speech. This is what makes a big animal sound big, and no
  // amount of filtering a plain fundamental substitutes for it. It is also
  // where the bass comes from.
  const subOsc = ctx.createOscillator();
  subOsc.type = 'sawtooth';
  subOsc.frequency.setValueAtTime(f0 * 0.36, at);
  subOsc.frequency.exponentialRampToValueAtTime(f0 * (0.75 + heat * 0.25), at + dur * 0.35);
  subOsc.frequency.exponentialRampToValueAtTime(f0 * 0.28, end);

  const subLp = ctx.createBiquadFilter();
  subLp.type = 'lowpass';
  subLp.frequency.value = 260;
  subLp.Q.value = 0.9;

  const subGain = ctx.createGain();
  subGain.gain.value = 0.62 + heat * 0.22;
  subOsc.connect(subLp).connect(subGain).connect(sum);

  // Chest weight. Kept around 50-95 Hz rather than an octave lower still: the
  // first pass sat at 20-45 Hz, which phone and laptop speakers cannot
  // reproduce at all — it ate headroom and delivered nothing audible.
  const weight = ctx.createOscillator();
  weight.type = 'triangle';
  weight.frequency.setValueAtTime(f0 * 0.5, at);
  weight.frequency.exponentialRampToValueAtTime(f0 * 0.38, end);
  const weightGain = ctx.createGain();
  weightGain.gain.value = 0.32;
  weight.connect(weightGain).connect(sum);

  // A little unfiltered source keeps the chest in, since bandpasses alone
  // sound thin and nasal.
  const body = ctx.createGain();
  body.gain.value = 0.5;
  const chest = ctx.createBiquadFilter();
  chest.type = 'lowpass';
  chest.frequency.value = 400;
  bank.connect(chest).connect(body).connect(sum);

  for (const node of [subOsc, weight]) {
    node.start(at);
    node.stop(end + 0.02);
    active.push(node);
  }
  active.push(subLp, subGain, weightGain);

  // Roughness WITHOUT periodicity. A clean sine LFO here is what made the
  // earlier version sound like a motorbike: 26-42 Hz of regular amplitude
  // pulsing is an engine firing rate, and the ear names it instantly. A real
  // growl is irregular, so the modulation is low-passed noise instead — same
  // roughness, no rhythm to lock onto.
  const wobbleSrc = noise();

  // Two lowpass stages, not one. Measured, a single biquad at 8 Hz still left
  // a 17 Hz bump in the amplitude envelope — a 12 dB/octave rolloff is not
  // steep enough, and 17 Hz is squarely motorbike-idle territory. Cascading
  // doubles the slope and puts the modulation where a growl flutter lives.
  const wobbleLp = ctx.createBiquadFilter();
  wobbleLp.type = 'lowpass';
  wobbleLp.frequency.value = 4.5 + heat * 3;
  const wobbleLp2 = ctx.createBiquadFilter();
  wobbleLp2.type = 'lowpass';
  wobbleLp2.frequency.value = 5 + heat * 3;

  const tremoloDepth = ctx.createGain();
  tremoloDepth.gain.value = 0.26 + heat * 0.16;
  wobbleSrc.connect(wobbleLp).connect(wobbleLp2).connect(tremoloDepth);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(0.8, at + Math.min(0.12, dur * 0.22));
  env.gain.setValueAtTime(0.8, end - dur * 0.4);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  tremoloDepth.connect(env.gain);

  sum.connect(env).connect(out);

  for (const node of [osc, jitter, breath, wobbleSrc]) {
    node.start(at);
    node.stop(end + 0.02);
    active.push(node);
  }
  active.push(bank, sum, body, chest, env, jitterDepth, breathGain, tremoloDepth, wobbleLp, wobbleLp2);
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

  // A recording, if the operator supplied one. Synchronous by design: the synth
  // must schedule against the current time without waiting on a fetch, and on
  // every default install there is no manifest and this is false.
  if (hasSamples('chewbacca')) playRecorded(text, onDone);
  else synthesise(text, onDone);
}

/** Play a supplied clip, falling back to synthesis if it cannot be used. */
async function playRecorded(text, onDone) {
  const out = ctx.createGain();
  out.gain.value = 0.9;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  out.connect(limiter).connect(ctx.destination);
  active.push(out, limiter);

  const seconds = await playSample(ctx, 'chewbacca', text, out);
  if (seconds == null) {
    synthesise(text, onDone);
    return;
  }

  const timer = setTimeout(() => {
    endTimers.delete(timer);
    if (endTimers.size === 0) {
      active = [];
      queueEndsAt = 0;
    }
    onDone?.();
  }, seconds * 1000 + 60);
  endTimers.add(timer);
}

function synthesise(text, onDone) {

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
  throat.frequency.value = 2600 + heat * 1200;
  throat.Q.value = 0.7;

  const master = ctx.createGain();
  master.gain.value = 0.42;

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
    // Longer. A roar needs room to travel; short bursts read as barks.
    const dur = Math.min(2.2, 0.45 + token.length * 0.1 + rand() * 0.25);
    // Lower than the formant rebuild, higher than the original rumble. The
    // weight now comes from the subharmonics rather than from dragging the
    // fundamental into the basement, which is what made it a diesel.
    const f0 = 105 + rand() * 55 + heat * 30;
    const shape = SHAPES[Math.floor(rand() * SHAPES.length)];
    growl(t, dur, f0, heat, shape, throat);
    t += dur + 0.04 + rand() * 0.08;
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
