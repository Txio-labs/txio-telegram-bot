# txio-telegram-bot

[![CI](https://github.com/txio-labs/txio-telegram-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/txio-labs/txio-telegram-bot/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

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

### Weekly bus-factor reports

The bot samples recent commit history and reports files whose commits are
highly concentrated in one human author. The default schedule is Monday at
09:00 UTC (`BUS_FACTOR_CRON=0 9 * * 1`). Reports contain at most five files per
repository and use the same repo chat/topic routing as issue notifications.

- `BUS_FACTOR_THRESHOLD_PERCENT` — minimum single-author concentration (default
  `70`).
- `BUS_FACTOR_MIN_COMMITS` — minimum non-bot commits touching a file (default
  `5`); smaller histories are excluded as too weak to be meaningful.
- `BUS_FACTOR_RECENT_COMMITS` — commits sampled per repository (default `30`).
- `BUS_FACTOR_TOP_FILES` — maximum files shown per repository (default `5`).

The data source is GitHub REST: one `GET /commits` request and one detail
request per sampled commit (`GET /commits/{sha}`), requested sequentially per
repository. This avoids local clone disk and authentication management, but a
four-repository deployment sampling 30 commits can use about 124 authenticated
API requests per weekly run. Set `GITHUB_TOKEN` for private repositories and
predictable rate limits; unauthenticated requests are limited to 60 per hour.
Bot-authored commits are ignored, and GitHub rename metadata is followed so
moved files retain their history. API failures are logged per repository.

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
- **Security alert private DM**: as above, set `SECURITY_ALERT_CHAT_ID` —
  security alert notifications go there instead of the group.

### Optional: security alert delivery

Security alert ("Dependabot alert raised") notifications are configurable
the same way as pull request notifications:

- `SECURITY_ALERT_CHANNEL` — `main_chat` (default) | `topic_thread` | `dm`
- `SECURITY_ALERT_FORMAT` — `markdown_summary` (default) | `plain_text` |
  `inline_buttons`

The supported combinations are `main_chat + markdown_summary` (default),
`topic_thread + markdown_summary`, and `dm + plain_text`. With no variables
set, security alerts post to the group's General topic with a linked
summary, matching the bot's other notifications.

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

### Optional: label filtering per destination

You can restrict which issues or pull requests trigger notifications by
adding a `labels` allowlist to any event-category entry. Only events whose
payload includes **at least one** label that exactly matches an entry in
the allowlist will be forwarded. Matching is **case-sensitive**.

```json
{
  "txio-labs/txio-backend": {
    "chatId": "-1001234567890",
    "issues": {
      "threadId": 101,
      "labels": ["urgent", "critical"]
    },
    "pullRequests": {
      "threadId": 102,
      "labels": ["urgent"]
    },
    "ci": 103,
    "deploys": 104
  }
}
```

In this example, only issues labelled `urgent` or `critical` will post to
thread 101, and only pull requests labelled `urgent` will post to thread
102. CI and deployment events are unaffected — they always pass through
regardless of any `labels` key on those entries.

**Edge cases:**

- An issue or pull request with **zero labels** when an allowlist is
  configured will **not** be forwarded to that destination.
- Label matching is exact and case-sensitive: `"Urgent"` does not match
  `"urgent"`.
- Events that carry no labels field in their payload — specifically CI
  (`workflow_run.completed`) and deployment (`deployment_status.created`)
  events — always pass through and are never filtered by a `labels` key.
- Suppressed events are logged at `debug` level so you can diagnose
  misconfigured allowlists.

## On-Demand Commands

The bot supports slash commands for querying GitHub state:

- **`/repo <name>`** — fetch a summary for one of the tracked repos:
  stars, forks, open issues, and open PR counts.
- **`/pr <repo>#<number>`** — fetch PR status, review state, and CI
  status for a specific pull request.
- **`/repo`** (no arguments) — list all configured repo names.

Repo names are resolved from the per-repo routing config
(see "Optional: multi-repo routing" below). You can use the short
name (e.g. `backend`) or the full name (e.g. `txio-labs/txio-backend`).

Requires `GITHUB_TOKEN` with `contents:read` and `pull_requests:read`
scope (already needed for merge-conflict detection).

## Run

```
npm install
npm run dev     # local development, ts via tsx
npm test        # run the unit test suite
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
