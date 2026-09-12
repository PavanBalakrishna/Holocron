# Recorded audio (optional, and empty by design)

Chewbacca is synthesised by `web/js/roar.js`. Synthesis gets the register, the
formant movement and the roughness, and stops there — a real recording is
better, and this folder is how one gets used.

**Nothing ships here.** The obvious recordings are Lucasfilm's, and this
project has no right to redistribute them. The hook is built; the files are
yours to supply, from a source you are entitled to use.

## Adding clips

1. Drop audio files in this folder — `.mp3`, `.ogg`, `.wav`, anything the
   browser decodes.
2. Create `roars.json` beside them:

   ```json
   { "chewbacca": ["roar-1.mp3", "roar-2.mp3", "roar-3.mp3"] }
   ```

That is the whole setup. With the manifest present Chewbacca plays a clip,
chosen deterministically from the text so the same line sounds the same, with a
slight random playback-rate shift so repeats do not sound looped. Without it —
the default — the synth answers and nothing changes.

A corrupt or undecodable file falls back to synthesis rather than leaving him
mute, so a bad clip cannot break the character.

## Two things worth knowing

**Anything in here is published.** GitHub Pages and Render both serve the
repository, so a file committed here is downloadable by anyone who visits. If
you are using audio you may hold privately but not distribute, keep it out of
the repo — add `web/audio/*.mp3` to `.gitignore` and accept that it works
locally but not on the hosted site.

**Where to find usable material.** Chewbacca's voice was built by Ben Burtt
from bear, walrus, badger, lion and camel recordings. Freely-licensed animal
recordings exist — Freesound and similar libraries carry CC0 and CC-BY
material — and layering a few gets closer to the original method than any
synthesiser will. Check the licence on each file; CC-BY needs attribution even
in a fan project.
