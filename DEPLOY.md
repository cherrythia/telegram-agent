# Deploying telegram-agent to Google Cloud Run

One-time setup, then a single command per deploy. Total cost at personal-bot
traffic: effectively $0 (Cloud Run free tier).

## Prerequisites

- A Google Cloud project with billing enabled (free tier still requires a card).
- `gcloud` CLI installed and authenticated: `gcloud auth login`, then
  `gcloud config set project <PROJECT_ID>`.
- A GitHub fine-grained PAT scoped to your context repo (the private repo
  holding `context/`, `decisions/`, `.claude/skills/` — see README) with
  **Contents: Read and write** (used to read context/skills and commit
  decision-log entries).

## 1. Store secrets in Secret Manager

```bash
gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com

printf '%s' "$TELEGRAM_BOT_TOKEN"      | gcloud secrets create telegram-bot-token --data-file=-
printf '%s' "$TELEGRAM_WEBHOOK_SECRET" | gcloud secrets create telegram-webhook-secret --data-file=-
printf '%s' "$ANTHROPIC_API_KEY"       | gcloud secrets create anthropic-api-key --data-file=-
printf '%s' "$GITHUB_TOKEN"            | gcloud secrets create aios-github-token --data-file=-
# Optional, only if you switch LLM_PROVIDER:
# printf '%s' "$OPENAI_API_KEY"     | gcloud secrets create openai-api-key --data-file=-
# printf '%s' "$OPENROUTER_API_KEY" | gcloud secrets create openrouter-api-key --data-file=-
# printf '%s' "$GEMINI_API_KEY"     | gcloud secrets create gemini-api-key --data-file=-
```

Grant the Cloud Run service account access (default compute SA shown):

```bash
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
for s in telegram-bot-token telegram-webhook-secret anthropic-api-key aios-github-token; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

## 2. Deploy

From the repo root (builds the Dockerfile via Cloud Build):

```bash
gcloud run deploy telegram-agent \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 1 \
  --memory 512Mi --cpu 1 \
  --set-env-vars "STORE=github,GITHUB_REPO=<your-user>/<your-context-repo>,GITHUB_BRANCH=main,LLM_PROVIDER=anthropic,ALLOWED_CHAT_IDS=<your-chat-id>" \
  --set-secrets "TELEGRAM_BOT_TOKEN=telegram-bot-token:latest,TELEGRAM_WEBHOOK_SECRET=telegram-webhook-secret:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,GITHUB_TOKEN=aios-github-token:latest"
```

`--allow-unauthenticated` is required so Telegram can reach the webhook; the
webhook secret + chat-ID allowlist are the auth layer. Note the service URL the
deploy prints (e.g. `https://telegram-agent-xxxxx.a.run.app`).

## 3. Point Telegram at Cloud Run

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://<service-url>/webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}"

# Verify:
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Send the bot a message and check logs if needed:
`gcloud run services logs read telegram-agent --region asia-southeast1 --limit 50`

## Switching LLM provider

Redeploy with different env (no code change):

```bash
gcloud run services update telegram-agent --region asia-southeast1 \
  --update-env-vars "LLM_PROVIDER=openrouter,LLM_MODEL=openai/gpt-4o-mini" \
  --update-secrets "OPENROUTER_API_KEY=openrouter-api-key:latest"
```

Supported: `anthropic` (default, `claude-sonnet-4-6`), `openai` (`gpt-4o-mini`),
`openrouter` (`openai/gpt-4o-mini`), `gemini` (`gemini-2.0-flash`). Override the
model with `LLM_MODEL`.

## Notes

- **Context freshness:** context files, skills, and the decision log are read
  from GitHub with a 60s cache — push to `main` and the bot sees it; no redeploy.
- **Decision log:** `log_decision` commits to `decisions/log.md` on `main`.
  `git pull` your context repo to pick entries up locally.
- **Scale-to-zero:** first message after idle has a ~1–2s cold start. Processing
  is synchronous, so slow LLM calls delay the webhook ack — Telegram tolerates
  this, and duplicate deliveries are deduped by `update_id`.
