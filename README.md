# telegram-agent

A personal AI assistant reachable via Telegram (@superman_aios_bot), deployed on
Google Cloud Run (scale-to-zero, effectively $0 at personal traffic). Previously
ran always-on on a Mac behind a Cloudflare Tunnel — see `DEPLOY.md` for the
deployment runbook.

## Architecture

```
┌─────────┐   HTTPS webhook    ┌──────────────────────────────────────┐
│Telegram  │ ────────────────▶ │ Google Cloud Run (asia-southeast1)   │
│ servers  │ ◀──────────────── │  Bun container, scale-to-zero        │
└─────────┘   sendMessage      │                                      │
     ▲                         │  server.ts → agent.ts → providers/   │
     │                         └──────┬──────────────────┬────────────┘
 you, on your                         │                  │
 phone chatting                       ▼                  ▼
 the bot                   GitHub contents API      LLM API
                           (context, skills,        Anthropic (default) or
                           decisions log)           OpenAI / OpenRouter / Gemini
                                                    via one OpenAI-compatible client
```

There is no owned server and no database. State lives in a GitHub repo;
compute is rented per-request from Cloud Run; the bot's identity is the
Telegram bot token.

**Code and context are separate repos.** This repo is only the code. The bot's
memory — context files, skills, decision log — lives in whatever (private) repo
`GITHUB_REPO` points at, so this code can be public while everything personal
stays out of it. Deploying your own instance means: fork this, create your own
context repo with the expected layout (`context/*.md`, `decisions/log.md`,
`references/voice.md`, `.claude/skills/`), and point the env vars at it.

### Life of a message

1. **You send a message.** Telegram POSTs the update to the Cloud Run webhook
   URL, carrying the secret token in a header.
2. **Cloud Run wakes up.** With `min-instances 0` there may be no container
   running; one cold-starts in ~1–2s and boots `bun server.ts`.
3. **`server.ts` gates the request**, in order: correct webhook secret (else
   401) → parseable JSON (else swallow with 200 so Telegram doesn't
   retry-loop) → not a duplicate `update_id` (Telegram re-delivers updates it
   thinks failed) → sender in `ALLOWED_CHAT_IDS` (else silently dropped).
4. **`agent.ts` dispatches** on the message shape:
   - `/skills` → lists skill directories from the repo.
   - `/audit`, `/level-up`, `/onboard` → fetches that skill's `SKILL.md` and
     sends it to the LLM as a one-shot "execute this" prompt.
   - Anything else → the tool-use loop. The LLM gets the message plus three
     tool definitions and decides whether to call them:
     - **`read_context(file)`** — reads one of an allowlisted set of files
       (`context/*.md`, `decisions/log.md`, `references/voice.md`) to ground
       the answer in real priorities and history.
     - **`log_decision({title, decision, why, alternatives})`** — appends a
       formatted entry to `decisions/log.md`.
     - **`save_note({note, topic})`** — appends a general note or learning to
       `context/notes.md` (which is also readable via `read_context`, so saved
       notes feed future answers).
     Each tool result is fed back to the model; the loop runs at most 4
     rounds, then the model produces the final text.
5. **The provider layer** (`providers/`) makes step 4 model-agnostic.
   `agent.ts` speaks a generic format (messages, tool calls, tool results);
   the selected provider translates to Anthropic's wire format or OpenAI-style
   function calling. `LLM_PROVIDER` / `LLM_MODEL` env vars pick the backend —
   switching models is a redeploy flag, not a code change.
6. **Storage goes through GitHub** because containers are disposable — local
   disk vanishes at scale-to-zero. Reads hit the contents API with a 60s
   cache, so pushing to `main` updates the bot's knowledge with no redeploy.
   `log_decision` is a real commit, so the decision log gains git history;
   `git pull` locally syncs entries back to the Mac.
7. **The reply is sent before the webhook is acknowledged.** Cloud Run freezes
   the CPU once the response is returned, so background work would stop —
   processing is synchronous by design (the biggest change from the Mac
   version, which processed async behind a tunnel).
8. **The container idles and dies.** After ~15 min without traffic it scales
   to zero and costs nothing.

### Secrets and config

The four credentials (bot token, webhook secret, Anthropic key, GitHub PAT)
live in Secret Manager and are injected as env vars at instance start — never
in the image, repo, or code. Non-secret config (`STORE=github`, `GITHUB_REPO`,
`LLM_PROVIDER`, `ALLOWED_CHAT_IDS`) is plain Cloud Run env. Locally,
`STORE=local` swaps GitHub for the Mac filesystem so `bun server.ts` works for
dev against the same code paths.

### Security model

- Only Telegram can invoke the bot meaningfully: requests without the webhook
  secret get 401.
- Only allowlisted chat IDs are answered; everyone else is silently dropped.
- The LLM's blast radius is exactly its three tools: read 6 allowlisted files,
  append to two of them. Path traversal is rejected before any lookup.
- One Telegram bot can't serve both a webhook and a `getUpdates` poller — the
  Claude Code Telegram channel plugin runs on a separate bot for this reason.

## Local development

```bash
bun install
cp .env.example .env   # STORE=local, fill in tokens
bun run server.ts
```

## Deploy

See `DEPLOY.md` — Cloud Run + Secret Manager + Telegram `setWebhook`.

## Testing

```bash
bun test
```
