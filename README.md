# LORD-V4D3R

> *"You have accessed a restricted terminal, Commander. State your query."*

An Imperial chat console powered by Claude. Star Wars themed front end, Darth Vader persona, bring-your-own-credential — deployable to GitHub Pages so other people can use it with their own Anthropic account.

---

## The one architectural constraint you need to know

You asked for the Claude Agent SDK **and** a browser-only app on GitHub Pages. Those two cannot both be literally true, so this repo does both properly rather than faking one:

| | Runtime | Auth | Tools | Where it runs |
|---|---|---|---|---|
| **Holonet Direct** | Anthropic Messages API via `@anthropic-ai/sdk` | user's own key/token, kept in their browser | `http_request` (browser `fetch`) | the static page, no server |
| **Imperial Bridge** | `@anthropic-ai/claude-agent-sdk` | OAuth / env / inherited `claude` login | Read, Glob, Grep, WebSearch, WebFetch | Node on your machine, or a container you host |

**Why the Agent SDK can't go in the browser:** `@anthropic-ai/claude-agent-sdk` is Claude Code packaged as a library. It spawns subprocesses and needs a filesystem. Its `/browser` export is *not* a standalone browser agent — it's a thin client that attaches to an already-provisioned server-side Claude Code session (internal, feature-flagged surface). GitHub Pages serves static files only, so there is no process for it to be.

The console auto-detects at load: if a bridge is reachable it uses the Agent SDK; otherwise it falls back to talking to Anthropic directly. Both paths share one persona file, so the character can't drift between them.

---

## Quick start

```bash
npm install

# Full experience — Agent SDK, tools, sessions
npm run bridge          # → http://127.0.0.1:8787

# Or just the static console, exactly as a static host will serve it
npm run web             # → http://127.0.0.1:8080

# Or the container, exactly as Render will run it
docker compose up --build   # → http://127.0.0.1:8787
```

The bridge picks up credentials in this order:

1. `ANTHROPIC_API_KEY`
2. `ANTHROPIC_AUTH_TOKEN` (OAuth bearer)
3. a token stored by `npm run login` (`~/.v4d3r/credentials.json`, mode 0600)
4. whatever `claude` / `ant` login already exists on the machine ← usually this one

Copy `.env.example` to `.env` to change the model, tool allowlist, port, or origins.

---

## Deploying to GitHub Pages

`.github/workflows/deploy-pages.yml` publishes `web/` verbatim on every push to `main`. There is no build step — the console is dependency-free ES modules — and it publishes `web/` specifically, not the repository root, so `server/`, the `Dockerfile` and `.env.example` stay off the public site.

**Two things to do, once each:**

1. **Settings → Pages → Source: GitHub Actions.** Until you do this the workflow runs and fails at the deploy step, because there is no Pages site to deploy to.
2. **Get your work onto `main`.** The workflow only triggers on `main` (plus manual runs from the Actions tab). A feature branch will not publish.

Your site lands at `https://YOURNAME.github.io/YOURREPO/`. The console is built with relative paths throughout, so it works from that subdirectory with no configuration.

### What you get on Pages, and what you don't

Pages serves static files, so **only Holonet Direct works there** — visitors paste their own Anthropic credential, which is stored in *their* browser (`sessionStorage` by default, `localStorage` if they tick "remember"). The site has no backend and never sees it. They also pick their own model and reasoning depth from the header; see [Model configuration](#model-configuration).

The Agent SDK needs a process, which Pages does not have. So on Pages the bridge is only reachable if a visitor is running one on their own machine — the console probes for that automatically and falls back. If you want the Agent SDK *hosted*, that is what the [Render deployment](#docker-and-hosting-on-render-for-free) is for; the two can coexist, and a Pages visitor can point at a hosted bridge with:

```js
localStorage.setItem('v4d3r.bridgeUrl', 'https://your-service.onrender.com')
localStorage.setItem('v4d3r.bridgeToken', '<the access token>')
```

That needs two edits first, and it fails quietly without them:

- **`connect-src` in `web/index.html`** lists only Anthropic, `'self'` and loopback. Add your bridge's origin, or the browser blocks the request before it leaves the page. This is the CSP doing its job — the deliberate cost of not allowing `https:` wholesale.
- **`V4D3R_ORIGINS` on the Render service** must include your Pages origin, or its CORS check refuses the request.

### A caveat worth setting expectations on

Holonet Direct sends requests from the visitor's browser to `api.anthropic.com` with `anthropic-dangerous-direct-browser-access: true`. If Anthropic does not permit direct browser access for that credential, the request fails CORS. The app detects this specific failure and says so plainly rather than showing a generic error, and points the user at bridge mode. **Test this with your own key before telling people the hosted page works.**

---

## Docker, and hosting on Render for free

```bash
docker build -t lord-v4d3r .
docker run --rm -p 127.0.0.1:8787:8787 lord-v4d3r   # → http://127.0.0.1:8787
```

or `docker compose up --build`, which does the same with the settings the
deployed service uses.

The image runs `server/src/index.js` — the same process as `npm run bridge` —
but with two defaults changed for a host rather than a laptop: it binds
`0.0.0.0`, and it takes its port from `$PORT` if the platform sets one
(Render, Fly and Heroku all do).

### Pick a mode before you deploy

`V4D3R_MODE` decides which half of the app a deployment is, and it is the only
decision that really matters here:

| | What it serves | Whose credential | Safe to leave open? |
|---|---|---|---|
| `static` *(default when bound publicly)* | the console only | each visitor's own, kept in their browser | **yes** — this process holds no credential |
| `bridge` *(default on loopback)* | console + `/api/chat` on the Agent SDK | **yours** | no — requires `V4D3R_ACCESS_TOKEN` |

Unset, it picks by bind address: a loopback bind is somebody running the bridge
on their own machine, so `npm run bridge` behaves exactly as it always has, and
a container bound to `0.0.0.0` gets the static console.

**Bridge mode on a public URL means strangers spend your Anthropic balance**,
with read-only tools pointed at your container. So the server refuses to boot
in that configuration unless `V4D3R_ACCESS_TOKEN` is set, and then `/api/chat`
requires `Authorization: Bearer <token>`. The console sends it from
`localStorage`:

```js
localStorage.setItem('v4d3r.bridgeToken', '<the token>')
```

That is a shared secret handed out per browser, not a login. It is enough to
keep your key off the open internet; it is not enough to run a service for
people you do not know.

### Deploying to Render

Render's free tier runs Docker web services, which is all this needs.

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → pick the repo. It reads `render.yaml`: one
   free web service, health-checked on `/health`, auto-deploying on push.
3. Open the `.onrender.com` URL. That's the console, in static mode — visitors
   paste their own Anthropic credential, which never leaves their browser.

To run the Agent SDK there instead, uncomment the bridge block in
`render.yaml` (it has Render generate the access token for you) and add
`ANTHROPIC_API_KEY` in the dashboard — never in the file, which is in git.
`V4D3R_TOOLS=none` is the honest setting for a deployment other people can
reach: `Read`/`Glob`/`Grep` see the container's own filesystem.

You don't need to set `V4D3R_PUBLIC_URL`; Render injects `RENDER_EXTERNAL_URL`
and the config picks it up to fix the OAuth redirect and allowlist the
console's own origin.

### Free-tier facts to set expectations on

- The service **sleeps after ~15 minutes** of no traffic, and the next visitor
  waits out a cold start of roughly a minute. In bridge mode that lands on top
  of the Agent SDK's own startup.
- There is **no persistent disk**. A token from `npm run login` written inside
  the container does not survive a deploy — use `ANTHROPIC_API_KEY`.
- Free web services share **750 instance-hours a month** across your account.

### Anywhere else

Nothing in the image is Render-specific. Any host that runs a container and
sets `$PORT` works the same way; set `V4D3R_PUBLIC_URL` yourself if the host
doesn't provide `RENDER_EXTERNAL_URL`.

---

## OAuth, honestly

The app implements a complete, standards-correct OAuth 2.1 Authorization Code + PKCE flow — in the browser (`web/js/auth.js`) and in the bridge with a loopback redirect (`server/src/oauth.js`). Neither needs a client secret.

What it does **not** ship with is endpoints, because **Anthropic does not currently publish self-serve OAuth client registration for third-party apps.** The `client_id` that Claude Code itself uses is a first-party client; pointing this app at it would mean impersonating Claude Code, so this repo does not do that.

So the OAuth path is wired and waiting. Fill in `V4D3R_OAUTH_*` in `.env` (or the `OAUTH` block in `web/js/config.js`) if you are issued a client, or if you point it at your own gateway fronting the Anthropic API — the "Sign in with OAuth" button un-greys itself automatically. Until then the working paths are the credential box and the bridge.

---

## Layout

```
web/                      ← the static console; all a static host needs
  index.html
  css/styles.css
  js/persona.js           ← THE character. Imported by both runtimes.
  js/config.js            ← model params, OAuth endpoints, bridge URL
  js/auth.js              ← credential store + browser PKCE
  js/transport.js         ← holonet + bridge, one event contract
  js/app.js               ← DOM, streaming, markdown
  js/vendor/              ← generated by `npm run vendor`, commit it
scripts/vendor-entry.js   ← bundle entry point
server/src/
  index.js                ← express, SSE, OAuth routes, static, mode + auth gate
  agent.js                ← Claude Agent SDK wrapper
  oauth.js                ← PKCE + token storage + credential resolution
  config.js
Dockerfile                ← the container both modes run in
docker-compose.yml        ← run that container locally
render.yaml               ← Render Blueprint, free tier
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

**On the bridge the operator picks**, via `V4D3R_MODEL` / `V4D3R_EFFORT` (`server/src/config.js`). The selectors go read-only and display the bridge's model, read from `/health`. That asymmetry is deliberate: the bridge answers on *your* credential, so letting a visitor choose the model would be letting them choose how much of your balance to spend.

## Live network access

Holonet has one tool, `http_request`, defined in `web/js/tools.js`. The model asks for a URL; the **visitor's browser** fetches it with `fetch()` and hands back the body. HTML is reduced to text, responses are capped at 120K characters, requests time out at 15s, and a turn may make at most 8 calls. There is a **DATALINK** toggle in the header, on by default; turning it off drops both the tool and its briefing from the request, so the model does not claim an ability it no longer has. Every call is shown in the transcript with its URL and outcome.

### CORS decides what actually works

A browser `fetch()` only succeeds if the target sends `Access-Control-Allow-Origin`. Public JSON APIs usually do. Ordinary web pages usually do not. **This is the browser's rule and no amount of code here changes it** — the only way around it is a server doing the fetching, which is what the bridge is for.

The tool therefore tells the model, in the failure string itself, that a failed fetch means the page is unreadable from a browser and that it must say so rather than invent the contents. That instruction is load-bearing: the alternative failure mode is a confident summary of a page nobody read.

### What this costs you, stated plainly

Turning this on required widening the CSP from `connect-src 'self' https://api.anthropic.com …` to include `https:`. That directive was the control that left an injected script with **nowhere to send a stolen API key**, and a wildcard removes it. There is no version of browser-side fetch that keeps it.

What still stands:

- **`script-src` is still `'self'`.** No third-party script can get onto the page to begin with; `connect-src` was defence in depth behind that, not the front line.
- **`https:` only** — no plaintext exfiltration, and `http://` targets are refused by the CSP.
- **The tool refuses `api.anthropic.com`**, so it cannot be turned into a way to replay the visitor's own credential.
- **The tool refuses loopback and private address space** (`127.0.0.0/8`, `10/8`, `192.168/16`, `172.16/12`, `169.254/16`, `*.local`). This matters specifically because a visitor may be running an unauthenticated bridge on their own machine, and a fetched page must not be able to talk the model into driving it. It is a hostname check, so a DNS name resolving into private space still gets through — the browser's CORS rules and the bridge's origin allowlist are the real defence; this is the cheap first line.
- **No credentials are ever attached.** `credentials: 'omit'`, and the only header the model can influence is `Content-Type` on a POST.
- **Fetched content is never rendered as the assistant's own words.** Tool rows are built with `textContent`, and the body never reaches the markdown renderer.

**Prompt injection is the honest residual risk.** Fetched pages are untrusted text entering the context of a model that can fetch again. The persona prompt tells it to treat fetched content as data and to report any instructions it finds rather than obey them, which is mitigation, not a guarantee. The blast radius is bounded by the fact that the model's only tool is an outbound request that never carries a credential.

If you do not want any of this: set `connect-src` back to `https://api.anthropic.com` in `web/index.html`. The tool then fails closed — the browser blocks it, the model is told it failed, nothing else breaks.

## Security notes

The threat that matters on a public deployment: **the page holds each visitor's API key in their browser, so any script execution on the page is credential theft.** Three things guard that.

- **No third-party JavaScript.** The Anthropic SDK is vendored into `web/js/vendor/` and served from your own origin. Loading it from a CDN would mean every visitor's key depends on that CDN not being compromised, and SRI can't cover a CDN's dynamically generated ESM bundles. Regenerate with `npm run vendor` after bumping the dependency.
- **CSP with `script-src 'self'`** and `default-src 'none'`. An injected script can't load code and has no origin to exfiltrate to except Anthropic. This is why the page carries no inline `style=` attributes — keeping `unsafe-inline` out of `style-src`. If you configure OAuth, add your token endpoint to `connect-src`.
- **Model output is escaped before rendering**, quotes included. That last part is not optional: the link rule interpolates a URL into `href="..."`, and HTML5 parsers recover from `href="x"onmouseover=…` by starting a *new* attribute. Escaping only `<`/`>`/`&` leaves a working XSS.

Bridge-specific (local users, not static-console visitors):

- The bridge binds `127.0.0.1` and, on loopback, has **no authentication** — anything running on your machine can drive it. Beyond loopback it will not start without `V4D3R_ACCESS_TOKEN`.
- Its tool allowlist is read-only by design. `V4D3R_TOOLS=none` makes it pure chat.
- `settingSources: []` means the bridge ignores your machine's `CLAUDE.md` and settings, so the persona is identical to the browser client's.
- **If you add a public origin to `V4D3R_ORIGINS`**, JavaScript served from that origin can drive your local Agent SDK, which can read files. Only allowlist origins you control, and understand you're trusting future deployments of them.
- **A hosted bridge is your credential on someone else's keyboard.** The boot guard (public bind + no `V4D3R_ACCESS_TOKEN` → exit) exists because that mistake is silent otherwise: the deployment works perfectly, and the bill arrives later. The token is a blunt instrument — one secret, no revocation, no per-user accounting. Deploy `static` unless you specifically want to pay for other people's turns.
- **Don't bake a `.env` into the image.** `.dockerignore` excludes it, because anyone who can pull a layer can read it. Secrets belong in the platform's environment settings.

Residual risks worth telling your users about: they are trusting *you* not to ship a malicious update, and an Anthropic API key is account-wide with billing attached — advise a dedicated key with a spend limit.

## Costs

Every message is billed to whoever's credential is in use. On the hosted page that's each visitor's own account, not yours.

---

*Fan project. Not affiliated with, endorsed by, or connected to Lucasfilm Ltd. or The Walt Disney Company. Star Wars and Darth Vader are their trademarks. Ship it as a parody/fan work and don't charge for it.*
