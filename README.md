# LORD-V4D3R

> *"My Master. The Executor stands ready. What is thy bidding?"*

An Imperial chat console powered by Claude. Star Wars themed front end, Darth Vader persona — **addressing you as his Master, the Emperor** — bring-your-own-credential, deployable as a static site so other people can use it with their own Anthropic account.

---

## What this is

**A static browser app. There is no server anywhere in it.**

| | |
|---|---|
| Runtime | Anthropic Messages API via `@anthropic-ai/sdk`, vendored into `web/js/vendor/` |
| Auth | the visitor's own key or bearer token, stored in *their* browser |
| Tools | `web_search` + `web_fetch` (hosted by Anthropic) and `http_request` (this browser's `fetch`) |
| Build step | none — `web/` is dependency-free ES modules |
| Hosting | anything that serves files: GitHub Pages, Render static, S3, a USB stick |

Every request goes from the visitor's browser straight to `api.anthropic.com`. Whoever hosts the page never sees a credential, never pays for a turn, and runs no code.

> **Previously** this repo also shipped an "Imperial Bridge" — a local Node process running the Claude Agent SDK, with filesystem tools, OAuth and a Docker/Render deployment. That half has been removed. If you want it, it is in the git history: `git log -- server/`.

### What you give up without the bridge

Worth knowing, since it is a real trade and not a free simplification:

- **No filesystem tools.** The Agent SDK's `Read`/`Glob`/`Grep` are gone. The model can read the web, not your disk.
- **No server-side OAuth.** Only the browser PKCE flow remains, and it stays dormant until you supply endpoints (see *OAuth, honestly* below).
- **No sessions.** Conversation state lives in the page and dies with the tab.
- **`http_request` is CORS-bound.** A browser fetch only reads sites that allow it. The hosted `web_search`/`web_fetch` have no such limit, which is why both exist.

---

## Quick start

```bash
npm install          # esbuild + the SDK, both build-time only
npm run web          # → http://127.0.0.1:8080
```

`npm run web` is a ~50-line zero-dependency static file server (`scripts/serve.js`), serving `web/` exactly as a host will. Nothing in `node_modules` is needed at runtime — `npm install` exists only so `npm run vendor` can rebuild the SDK bundle after a version bump.

Then click **Credentials** and paste an Anthropic API key. It is stored in `sessionStorage` by default, or `localStorage` if you tick "remember", and is sent only to Anthropic.

---

## Deploying

### Render (static)

`render.yaml` declares a **static site**, not a container. Render → New → Blueprint → pick the repo.

Being static rather than a web service is a real upgrade over the Docker deployment this replaces: **no spin-down, so no cold start**, no instance hours consumed, and it is served from Render's CDN. The blueprint also sets the CSP and a couple of hardening headers at the edge, mirroring the page's own meta tag.

### GitHub Pages

`.github/workflows/deploy-pages.yml` publishes `web/` verbatim on every push to `main`. There is no build step, and it publishes `web/` specifically rather than the repository root, so `scripts/` and `package.json` stay off the public site.

**Two things to do, once each:**

1. **Settings → Pages → Source: GitHub Actions.** Until you do this the workflow runs and fails at the deploy step, because there is no Pages site to deploy to.
2. **Get your work onto `main`.** The workflow only triggers on `main` (plus manual runs from the Actions tab). A feature branch will not publish.

Your site lands at `https://YOURNAME.github.io/YOURREPO/`. The console uses relative paths throughout, so it works from that subdirectory with no configuration.

### Anywhere else

`web/` is a folder of static files. Any host will do. Nothing in it reads an environment variable, so there is nothing to configure per host.

### The one caveat worth setting expectations on

The page sends requests to `api.anthropic.com` with `anthropic-dangerous-direct-browser-access: true`. **If Anthropic does not permit direct browser access for a given credential, the request fails CORS** — and with no bridge to fall back to, that is the end of the road for that credential. The app detects this specific failure and says so in those words rather than showing a generic error, and suggests trying an API key instead of an OAuth token.

**Test it with your own key before telling people the hosted page works.** This is account-dependent and not something the code can fix.

## OAuth, honestly

The app implements a complete, standards-correct OAuth 2.1 Authorization Code + PKCE flow in the browser (`web/js/auth.js`). PKCE is precisely the flow that needs no client secret, which is what makes it viable on a page whose source everybody can read.

What it does **not** ship with is endpoints, because **Anthropic does not currently publish self-serve OAuth client registration for third-party apps.** The `client_id` that Claude Code itself uses is a first-party client; pointing this app at it would mean impersonating Claude Code, so this repo does not do that.

So the OAuth path is wired and waiting. Fill in the `OAUTH` block in `web/js/config.js` if you are issued a client, or if you point it at your own gateway fronting the Anthropic API — the "Sign in with OAuth" button un-greys itself automatically, and you will also need to add your token endpoint to `connect-src`. Until then the working path is the credential box.

---

## Layout

```
web/                      ← the whole application
  index.html
  css/styles.css
  js/persona.js           ← THE character, and the clock
  js/config.js            ← models, depths, network + voice settings
  js/auth.js              ← credential store + browser PKCE
  js/tools.js             ← hosted search/fetch defs + the browser fetch tool
  js/transport.js         ← the request and the tool loop
  js/voice.js             ← speechSynthesis + SpeechRecognition
  js/app.js               ← DOM, streaming, markdown
  js/vendor/              ← generated by `npm run vendor`, commit it
scripts/
  serve.js                ← zero-dependency local preview
  vendor-entry.js         ← bundle entry point
render.yaml               ← Render static-site blueprint
.github/workflows/        ← Pages deploy
```

## Model configuration

**On Holonet Direct the visitor picks.** Two selectors sit in the header — model, and how deeply it reasons. The visitor's own credential pays for the turn, so the choice and its cost belong to them. Both persist per browser (`v4d3r.model`, `v4d3r.level`).

| Model | Depths offered | Default |
|---|---|---|
| `claude-opus-5` | Shallow → Absolute (`low`…`max` effort) | Shallow |
| `claude-sonnet-5` | Shallow → Absolute | Shallow |
| `claude-haiku-4-5` | Shallow → Deep | Measured |

Defaults are Opus 5 at Shallow: conversational chat doesn't repay deeper reasoning, and it keeps the visitor's bill down. The reasoning itself is rendered in a collapsible **MEDITATION** panel, which is why adaptive thinking is requested with `display: "summarized"` — the API default, `"omitted"`, streams empty thinking blocks and reads as a dead pause.

**The request shape is not portable between models, which is why `MODELS` in `web/js/config.js` is a table rather than one shared params object.** Send Opus 5's parameters to Haiku 4.5 and you get a 400, not a worse answer: Haiku rejects `output_config.effort` outright, and has no adaptive thinking — reasoning there is the older fixed `budget_tokens` ceiling. So each row declares the depths it supports and how they translate, and `requestShape()` assembles the body. Adding a model is one row. Haiku also offers no Profound/Absolute, because those are effort levels and it has no effort parameter; a stored depth that a newly selected model can't accept is coerced at selection time, not at request time.

Switching model mid-conversation is safe and needs no reset. Thinking blocks are bound to the model that produced them and are silently dropped if replayed elsewhere — but the transcript sent back to the API holds plain text only, so there is nothing to lose.

The selectors are greyed out until a credential exists, since there is nothing to spend until then.

## Live network access

Two kinds, and the difference is **where the request comes from**:

| | Runs on | Reaches | Costs | Reveals |
|---|---|---|---|---|
| `web_search`, `web_fetch` | Anthropic's servers | anything — CORS does not apply | billed per search, on top of tokens | Anthropic's address |
| `http_request` | the visitor's browser | CORS-enabled URLs only | tokens only | the **visitor's own IP** to whatever it reads |

The **DATALINK** selector in the header chooses between them: `full` (both), `search` (hosted only — the web without handing your address to it), `off` (neither). Whatever is off is stripped from both the tools array *and* the system briefing, so the model never describes a search it could not have run.

Every call appears in the transcript, amber for hosted and blue for browser-side, with its query or URL and the outcome.

### Why both

`web_search` is the answer to "can it Google things" — yes, because no browser is involved. `web_fetch` then retrieves any URL already named in the conversation.

`http_request` earns its place for APIs, and for anything where the visitor's own network position is the point. It is defined in `web/js/tools.js`: HTML is reduced to text, bodies cap at 120K characters, requests time out at 15s, and a turn allows at most 8 calls.

### CORS decides what `http_request` can read

A browser `fetch()` only succeeds if the target sends `Access-Control-Allow-Origin`. Public JSON APIs usually do. Ordinary web pages usually do not — `google.com/search` and `example.com` both refuse. **This is the browser's rule and no code here changes it.**

Measured, for calibration: `api.github.com/rate_limit` sends `ACAO: *` and works; `api.github.com/zen` sends none and fails. Same host, different endpoint.

The tool therefore tells the model, in the failure string itself, that a failed fetch means the page is unreadable from a browser and that it should reach for `web_fetch` instead — and must never invent the contents. That instruction is load-bearing: the alternative failure mode is a confident summary of a page nobody read.

### The model is told the time

`clockBlock()` in `web/js/persona.js` puts the operator's local date, time and time zone into every request, as a second system block after the persona.

This is not a nicety — without it the model has **no clock at all**, and "what time is it" cannot be answered. Search does not rescue it either: pages that display a clock build it in JavaScript, so the text a search returns contains no time. The browser already knows the answer exactly, so it hands it over and the prompt tells the model never to search for it.

It is a separate block on purpose. The persona is stable for a session and the clock changes every request, so when a `cache_control` breakpoint is eventually added to the persona block, the volatile half is already on the correct side of it.

A turn that spends tool calls and then returns no text now says so, rather than rendering an ellipsis that looks like a broken app.

### Model-gated tool versions

The hosted tools are versioned types, not assumed capabilities. `web_search_20260209` / `web_fetch_20260209` (with dynamic filtering) need Opus 4.6+ or Sonnet 4.6+; Haiku 4.5 takes the earlier `web_search_20250305` / `web_fetch_20250910`. Naming a version a model does not accept is a request error, so the pair lives in the same `MODELS` table as everything else model-specific. The 20260209 variants run code execution internally, which is why `code_execution` is deliberately *not* declared alongside them.

### What this costs you, stated plainly

`http_request` required widening the CSP from `connect-src 'self' https://api.anthropic.com …` to include `https:`. That directive was the control that left an injected script with **nowhere to send a stolen API key**, and a wildcard removes it. There is no version of browser-side fetch that keeps it.

Note the asymmetry: **the hosted tools cost you none of this.** They need no CSP change at all, because the page only ever talks to `api.anthropic.com`. If you want search without giving that up, set `connect-src` back to `https://api.anthropic.com` and run the selector on `search` — `web_search` and `web_fetch` keep working and `http_request` fails closed.

What still stands:

- **`script-src` is still `'self'`.** No third-party script can get onto the page to begin with; `connect-src` was defence in depth behind that, not the front line.
- **`https:` only** — no plaintext exfiltration, and `http://` targets are refused by the CSP.
- **The tool refuses `api.anthropic.com`**, so it cannot be turned into a way to replay the visitor's own credential.
- **The tool refuses loopback and private address space** (`127.0.0.0/8`, `10/8`, `192.168/16`, `172.16/12`, `169.254/16`, `*.local`). A visitor's own network is not the web: a router admin page or an unauthenticated dev server is exactly what fetched text should not be able to reach through them. It is a hostname check, so a DNS name resolving into private space still gets through — the browser's CORS rules are the real defence; this is the cheap first line.
- **No credentials are ever attached.** `credentials: 'omit'`, and the only header the model can influence is `Content-Type` on a POST.
- **Fetched content is never rendered as the assistant's own words.** Tool rows are built with `textContent`, and the body never reaches the markdown renderer.

**Prompt injection is the honest residual risk**, and it applies to search results as much as to fetched pages: untrusted text entering the context of a model that can fetch again. The persona prompt tells it to treat retrieved content as data and to report any instructions it finds rather than obey them, which is mitigation, not a guarantee. The blast radius is bounded by the fact that every tool the model has is an outbound request that never carries a credential.

If you do not want any of this: set the DATALINK selector to `off`, or set `connect-src` back to `https://api.anthropic.com` in `web/index.html` to disable the browser half specifically. Either way it fails closed — the model is told the request failed, and nothing else breaks.

## Voice

Off by default. The **VOICE** selector offers `speak` (the construct talks) and `speak + listen` (a microphone button appears in the composer). Both halves use only what the browser already has — no extra service, no second API key, no CSP change.

**Set expectations before you enable it: this is not Vader's voice.** `speechSynthesis` uses the voices your operating system ships, and none of them is James Earl Jones. The effect is pitch floored to `0.1` and rate slowed to `0.85` on the deepest available voice, which reads as a slow, ominous android. Atmospheric, and honestly labelled as such in the UI. The rasp, the timbre and the breathing are not reachable from a browser.

It also varies per machine: macOS "Daniel" and a Windows "David" sound quite different, and a bare Linux install may have **no voices at all** — the console says so rather than failing silently.

### Speaking

Spoken per sentence as the reply streams, so the voice starts on the first complete clause instead of after the whole answer. Markdown is reduced before speaking — `**bold**` read aloud is "asterisk asterisk bold", and a URL is a minute of punctuation — and **fenced code blocks are skipped entirely**, because nobody wants forty lines of JavaScript recited. Halt, Purge, a new message, or switching the selector all cut the voice off immediately.

### Listening

**Dictation is the one part of this page that is not local.** Chrome implements `SpeechRecognition` by sending the recorded audio to Google for transcription. On a page whose whole claim is that your credential never leaves your browser, that deserves saying out loud, so the console prints a one-time warning the first time you enable it.

Firefox has never implemented `SpeechRecognition`, so the microphone hides itself there rather than sitting dead. Speaking still works.

Transcribed text lands in the composer **for you to review** — it is not transmitted automatically. A misheard sentence sent on its own would spend your credential on the wrong question.

## Security notes

The threat that matters on a public deployment: **the page holds each visitor's API key in their browser, so any script execution on the page is credential theft.** Three things guard that.

- **No third-party JavaScript.** The Anthropic SDK is vendored into `web/js/vendor/` and served from your own origin. Loading it from a CDN would mean every visitor's key depends on that CDN not being compromised, and SRI can't cover a CDN's dynamically generated ESM bundles. Regenerate with `npm run vendor` after bumping the dependency.
- **CSP with `script-src 'self'`** and `default-src 'none'`. An injected script cannot load code from anywhere, which is the control that actually matters. This is why the page carries no inline `style=` attributes — keeping `unsafe-inline` out of `style-src`. If you configure OAuth, add your token endpoint to `connect-src`.
  **Note the honest limit here:** `connect-src` also allows `https:`, because the `http_request` tool fetches URLs chosen at runtime. So unlike earlier versions of this page, CSP no longer denies an injected script somewhere to send a stolen key — see [What this costs you](#what-this-costs-you-stated-plainly). `script-src` is what stands between you and that, not `connect-src`.
- **Model output is escaped before rendering**, quotes included. That last part is not optional: the link rule interpolates a URL into `href="..."`, and HTML5 parsers recover from `href="x"onmouseover=…` by starting a *new* attribute. Escaping only `<`/`>`/`&` leaves a working XSS.

Residual risks worth telling your users about: they are trusting *you* not to ship a malicious update, and an Anthropic API key is account-wide with billing attached — advise a dedicated key with a spend limit.

## Costs

Every message is billed to whoever's credential is in use. On the hosted page that is each visitor's own account, never yours — you are paying for static file hosting and nothing else.

Two things cost more than plain tokens, and both are the visitor's choice in the header: **hosted `web_search` is billed per search** on top of tokens, and **reasoning depth** multiplies the tokens a turn spends. The defaults are the cheap end — Opus 5 at Shallow — and `Datalink off` removes the search cost entirely.

---

*Fan project. Not affiliated with, endorsed by, or connected to Lucasfilm Ltd. or The Walt Disney Company. Star Wars and Darth Vader are their trademarks. Ship it as a parody/fan work and don't charge for it.*
