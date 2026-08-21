# txio-telegram-bot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

Ops bot for the Txio team.

- Listens for GitHub webhook events (issues, pull requests, CI runs,
  deployments, branch create/delete, force-pushes to the default branch)
  and posts a formatted notification into the Telegram group.
  Each event type can optionally be routed to its own forum topic, and pull
  requests can be routed to a private DM instead of the group.
- Welcomes new members when they join the group.

## Notifications

### CI runs

Workflow runs are only reported once they reach a **completed** state
(`success`, `failure`, `cancelled`, ...). The intermediate
`requested` / `in_progress` transitions are intentionally **not**
notified: they are emitted for every queued/in-flight build and would
roughly double the message volume for little extra signal, while the
completion event still surfaces every outcome, including cancelled runs.
Only `workflow_run.completed` is subscribed to in
`src/github/webhooks.ts`.

### Stale PR/issue reminders

The bot is otherwise fully webhook-driven, but it also runs a scheduled job
that posts a daily digest of stale open PRs and issues. Anything with no
activity (`updated_at`) for `STALE_THRESHOLD_DAYS` (default `7`) is grouped
into a single digest message per destination chat — one message listing all
stale items, not one message per item. Repos with nothing stale are skipped
quietly.

- **Schedule**: `STALE_REMINDER_CRON` (default `0 9 * * *` — 09:00 UTC).
  Standard cron syntax; an invalid expression disables the reminder and logs
  a warning.
- **Tracked repos**: the keys of the `REPO_ROUTING_CONFIG_PATH` file, or
  `STALE_REPO_NAMES` (comma-separated) when no routing file is set. Each
  digest is routed to the repo's configured chat/topic (see
  [multi-repo routing](#optional-multi-repo-routing)).
- **Rate limits**: each repo is queried with a single
  `GET /repos/{repo}/issues?state=open` call (the issues endpoint includes
  pull requests). Set `GITHUB_TOKEN` to avoid the unauthenticated
  60 requests/hour limit when monitoring several repos.
- **Failures**: per-repo API errors and per-message send errors are logged
  and never crash the service or abort the rest of the job.
- **Message size**: digests are capped below Telegram's 4096-character limit;
  overflow items are dropped and reported with a "…and N more" footer.

## Setup

1. **Create the bot**: message [@BotFather](https://t.me/BotFather) on
   Telegram, run `/newbot`, and copy the token into `TELEGRAM_BOT_TOKEN`.
2. **Add the bot to the group** as a regular member (no admin needed).
3. **Get the group's chat id**: send any message in the group, then check
   `https://api.telegram.org/bot<TOKEN>/getUpdates` for `"chat":{"id": ...}`
   (group ids are negative, supergroup/forum ids look like
   `-100xxxxxxxxxx`). Set `TELEGRAM_CHAT_ID`.
4. **Deploy it** somewhere with a public URL (see Docker/Render below) and
   set `PUBLIC_URL` to that URL — it's used to register the Telegram
   webhook that powers the new-member welcome message.
5. **Configure the GitHub webhook**: in the repo's (or org's) Settings >
   Webhooks, add a webhook pointing at `<PUBLIC_URL>/webhooks/github`,
   content type `application/json` (GitHub defaults to
   `application/x-www-form-urlencoded` — you must change this), and a
   secret matching `GITHUB_WEBHOOK_SECRET`. Subscribe to: Issues, Issue
   comments, Pull requests, Workflow runs, Deployment statuses, Branches,
   Releases.
6. **(Optional) Set GITHUB_TOKEN**: for merge-conflict detection on private
   repos and to avoid rate limits on public repos, create a fine-grained
   personal access token (PAT) or GitHub App installation token with
   `pull_requests: read` scope and set it as `GITHUB_TOKEN`. Without this,
   merge-conflict alerts will not work for private repos and may fail on
   public repos due to the 60 requests/hour unauthenticated rate limit.
7. Copy `.env.example` to `.env` and fill in the values above.

### Optional: per-topic and DM routing

The group needs Topics enabled (Group settings > Topics) for thread
routing to work.

- **Topic ids**: open the topic, send a message, then check
  `getUpdates` for `"message_thread_id"` in that update. Set
  `TOPIC_THREAD_ISSUES` / `TOPIC_THREAD_CI` / `TOPIC_THREAD_DEPLOYS` /
  `TOPIC_THREAD_BRANCHES` / `TOPIC_THREAD_RELEASES`.
  Unset ones fall back to the group's General topic.
- **PR private DM**: DM the bot directly, send it any message, then check
  `getUpdates` for that message's `"chat":{"id": ...}` (your personal chat
  id, a positive number). Set `PULL_REQUEST_CHAT_ID` — pull request
  notifications go there instead of the group.

### Optional: multi-repo routing

When the bot serves multiple repositories, you can route each repo's
notifications to a distinct chat or forum topic. Create a JSON file
(modelled on `repo-routing.example.json`) and set
`REPO_ROUTING_CONFIG_PATH` to its path:

```json
{
  "txio-labs/txio-backend": {
    "chatId": "-1001234567890",
    "issues": 101,
    "pullRequests": 102,
    "ci": 103,
    "deploys": 104,
    "branches": 110,
    "releases": 112
  },
  "txio-labs/txio-cli": {
    "chatId": "-1001234567890",
    "deploys": 105
  }
}
```

Each key is a `repository.full_name` (case-insensitive). The value is an
object with:

- `chatId` (optional) — overrides `TELEGRAM_CHAT_ID` for that repo.
- `issues` / `pullRequests` / `ci` / `deploys` / `branches` / `releases` (optional) —
  overrides the corresponding `TOPIC_THREAD_*` for that event type in
  that chat.

Repos not present in the file, or event types left blank, fall back to the
defaults (`TELEGRAM_CHAT_ID` and `TOPIC_THREAD_*` env vars).

## Run

```
npm install
npm run dev     # local development, ts via tsx
npm run build && npm start   # production
```

## Docker

```
docker build -t txio-telegram-bot .
docker run --env-file .env -p 3000:3000 txio-telegram-bot
```

## Render

`render.yaml` is included — Render dashboard > New > Blueprint, connect
this repo, and set the secret env vars (`TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, `GITHUB_WEBHOOK_SECRET`, `PUBLIC_URL`, and any of the
optional routing vars) in the dashboard.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for bug reports, enhancement
suggestions, and the PR process. Please also read our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

MIT — see [LICENSE](./LICENSE).
