# telegram-agent

A headless Telegram webhook service hosted on Google Cloud Run (scale-to-zero).
There is no frontend and no local daemon — `bun server.ts` runs the same code
locally that the container runs in Cloud Run. Read `README.md` for the
architecture and `DEPLOY.md` for the deploy runbook before changing behavior.

## Runtime: Bun, not Node

- `bun <file>`, `bun test`, `bun install` — never `node`, `jest`/`vitest`, or `npm`.
- `Bun.serve()` for HTTP (see `server.ts`). Don't add `express`.
- Bun loads `.env` automatically — don't add `dotenv`.
- `fetch` is built in; all external calls (Telegram, GitHub, LLM APIs) use it
  directly. Don't add HTTP client libraries.

## Constraints that shape the code

- **Cloud Run freezes the CPU after the HTTP response is sent.** All work,
  including the Telegram reply, must finish before the webhook handler returns.
  Never move processing to a background task after the response.
- **Containers are disposable (scale-to-zero).** No local state survives a
  request. Persistent state goes through `lib/github_store.ts` (GitHub contents
  API) when `STORE=github`, or the local filesystem when `STORE=local` (dev).
- **This repo is public; the bot's context repo is private.** Never commit
  secrets, personal file paths, real chat IDs, or references to the owner's
  private repos. Keep the repo-local git identity (GitHub noreply email) intact.

## Testing

- `bun run test` (uses `--isolate`) is the canonical run; plain `bun test` must
  also stay green because that's what people type.
- Bun's `mock.module` is process-global across test files. House rule: any
  module that another test file registers with `mock.module` must be imported
  by its own test file with a cache-busting query
  (`await import("./agent?" + Math.random())`) — see `agent.test.ts` and
  `tools/reply.test.ts` for the pattern and the comment explaining why.
- Tests that set env vars (`GITHUB_REPO`, `STORE`, …) or replace
  `globalThis.fetch` should restore them in `afterEach`; leaked globals across
  files caused real failures before.
