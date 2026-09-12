/**
 * HOLOCRON — optional recorded audio for a character.
 *
 * Synthesis gets the register and the roughness and stops there. A real
 * recording is better, and this is how one gets used — but the repo ships
 * none, because the obvious recordings are Lucasfilm's and this project has no
 * right to redistribute them. The hook is here; the file is yours to supply.
 *
 * To use it, drop audio files into web/audio/ and list them in
 * web/audio/roars.json:
 *
 *     { "chewbacca": ["roar-1.mp3", "roar-2.mp3", "roar-3.mp3"] }
 *
 * With that present, Chewbacca plays a clip instead of synthesising. Without
 * it — which is the default — nothing changes and the synth answers. There is
 * no build step and no configuration beyond the file.
 *
 * NOTE the manifest is fetched from this origin, so `media-src 'self'` is in
 * the page CSP. Nothing here can load audio from anywhere else.
 */

const MANIFEST_URL = './audio/roars.json';

let manifest = null;
let manifestLoaded = false;
const buffers = new Map();

/**
 * Started at import, not at first roar.
 *
 * The check has to be answerable synchronously: roar() schedules Web Audio
 * nodes against ctx.currentTime, and awaiting a fetch first both delays the
 * first growl and risks two queued roars resolving out of order. So the
 * manifest is fetched once on load and the answer is cached; anything asked
 * before it lands is simply told "no samples", which is the right answer on
 * every default install anyway.
 */
const ready = loadManifest();

/**
 * Read the manifest once. A missing file is the normal case, not an error, so
 * it is swallowed and recorded as "no samples" rather than logged as a failure
 * every time the page loads.
 */
async function loadManifest() {
  if (manifestLoaded) return manifest;
  manifestLoaded = true;
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) return (manifest = null);
    const json = await res.json();
    manifest = json && typeof json === 'object' ? json : null;
  } catch {
    manifest = null;
  }
  return manifest;
}

/** Synchronous: false until the manifest has landed, and false without one. */
export function hasSamples(character) {
  return Array.isArray(manifest?.[character]) && manifest[character].length > 0;
}

/** For callers that genuinely want to wait — tests, mostly. */
export function samplesReady() {
  return ready;
}

/** Deterministic pick, so the same line plays the same clip. */
function pick(list, seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return list[(h >>> 0) % list.length];
}

/**
 * Play one clip for this character.
 *
 * Routed through the caller's own gain and limiter rather than straight to the
 * destination, so a recording and the synth sit at the same level and the
 * hands-free loop sees them finish the same way.
 *
 * @returns {Promise<number|null>} clip length in seconds, or null if nothing
 *   could be played — the caller falls back to synthesis on null.
 */
export async function playSample(ctx, character, text, destination) {
  const list = manifest?.[character];
  if (!Array.isArray(list) || !list.length) return null;

  const file = pick(list, String(text));
  const url = `./audio/${file}`;

  try {
    if (!buffers.has(url)) {
      const res = await fetch(url);
      if (!res.ok) return null;
      buffers.set(url, await ctx.decodeAudioData(await res.arrayBuffer()));
    }
    const buf = buffers.get(url);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    // A little variation so repeated clips do not sound looped.
    src.playbackRate.value = 0.92 + Math.random() * 0.16;
    src.connect(destination);
    src.start();
    return buf.duration / src.playbackRate.value;
  } catch {
    // A corrupt or unsupported file falls back to the synth rather than
    // leaving the character mute.
    return null;
  }
}
