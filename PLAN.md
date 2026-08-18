# Plan: Configurable "Pull Request Closed" Notifications

## Scope Decision

Per the recommendation: **implement 2–3 delivery combinations**, close the rest as won't-do.

### Implemented (3 combinations)

| # | Channel | Format | Why |
|---|---------|--------|-----|
| 1 | `main_chat` | `markdown_summary` | Default — backward compatible with current behavior |
| 2 | `topic_thread` | `markdown_summary` | Forum groups — `TOPIC_THREAD_PULL_REQUESTS` already exists in config but is unused for closed PRs |
| 3 | `dm` | `plain_text` | Personal alerts — `PULL_REQUEST_CHAT_ID` already exists but has no format switching |

### Won't do (no infrastructure)

SMS, digest email, RSS entry, push notification, voice message, rich card+image, JSON payload, ticker line, pinned message, webhook — none of these have existing infrastructure in the bot.

---

## Implementation

### Step 1: Add config keys (`src/config.ts`)

Add a new `prClosed` config object, mirroring the existing `prOpened` pattern:

```typescript
prClosed: {
  channel: process.env.PR_CLOSED_CHANNEL ?? "main_chat",
  format: process.env.PR_CLOSED_FORMAT ?? "markdown_summary",
},
```

Env vars:
- `PR_CLOSED_CHANNEL` — `"main_chat" | "topic_thread" | "dm"` (default: `"main_chat"`)
- `PR_CLOSED_FORMAT` — `"plain_text" | "markdown_summary" | "inline_buttons"` (default: `"markdown_summary"`)

### Step 2: Add formatter (`src/github/formatters.ts`)

Create `formatPullRequestClosedEvent` following the same signature pattern as `formatPullRequestOpenedEvent`:

```typescript
export function formatPullRequestClosedEvent(
  event: EmitterWebhookEvent<"pull_request">,
  format: string
): { text: string; parseMode?: "HTML"; replyMarkup?: any }
```

Three format modes:
- `"plain_text"` — no HTML, no links (safe for DMs, plain-text channels)
- `"markdown_summary"` — HTML with clickable links (default, current behavior)
- `"inline_buttons"` — HTML text + InlineKeyboard "View Pull Request" button

The formatter must handle both `closed` (merged vs just closed) and `reopened` actions, preserving the existing icon/label logic from `formatPullRequestEvent`.

### Step 3: Update webhook handler (`src/github/webhooks.ts`)

Replace the current `pull_request.closed` / `pull_request.reopened` handler:

**Before:**
```typescript
webhooks.on(["pull_request.closed", "pull_request.reopened"], async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const message = formatPullRequestEvent(event);
  if (config.pullRequestChatId) {
    await sendMessage(config.pullRequestChatId, message);
  } else {
    await notifyChannel(message);
  }
});
```

**After:**
```typescript
webhooks.on(["pull_request.closed", "pull_request.reopened"], async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const { channel, format } = config.prClosed;
  const { text, parseMode, replyMarkup } = formatPullRequestClosedEvent(event, format);

  let targetChatId: string | number = config.telegramChatId;
  let threadId: number | undefined;

  if (channel === "topic_thread") {
    threadId = config.topicThreads.pullRequests;
  } else if (channel === "dm") {
    if (config.pullRequestChatId) {
      targetChatId = config.pullRequestChatId;
    }
  }

  await sendMessage(targetChatId, text, threadId, { parseMode, replyMarkup });
});
```

This mirrors the `pull_request.opened` handler exactly.

### Step 4: Update `.env.example`

Add documentation for the new env vars:

```
# Optional: configure where and how "pull request closed" notifications are delivered.
# PR_CLOSED_CHANNEL: "main_chat" (default) | "topic_thread" | "dm"
# PR_CLOSED_FORMAT: "markdown_summary" (default) | "plain_text" | "inline_buttons"
PR_CLOSED_CHANNEL=
PR_CLOSED_FORMAT=
```

Also add `TOPIC_THREAD_PULL_REQUESTS` to the `.env.example` since it exists in code but is not documented in the example file.

### Step 5: Remove old `formatPullRequestEvent` or keep as alias

The old `formatPullRequestEvent` function can be removed since nothing will call it after the refactor. Alternatively, keep it as a simple wrapper that calls `formatPullRequestClosedEvent(event, "markdown_summary").text` for backward compatibility — but since it has no callers, removing is cleaner.

---

## Files Modified

| File | Change |
|------|--------|
| `src/config.ts` | Add `prClosed.channel` and `prClosed.format` |
| `src/github/formatters.ts` | Add `formatPullRequestClosedEvent`, remove `formatPullRequestEvent` |
| `src/github/webhooks.ts` | Rewrite closed/reopened handler to use channel routing |
| `.env.example` | Document new env vars + `TOPIC_THREAD_PULL_REQUESTS` |

---

## Backward Compatibility

- Default values (`main_chat` + `markdown_summary`) produce identical output to the current behavior when no new env vars are set
- The existing `PULL_REQUEST_CHAT_ID` env var continues to work — when `PR_CLOSED_CHANNEL=dm` is set, it uses `PULL_REQUEST_CHAT_ID` as the target
- `TOPIC_THREAD_PULL_REQUESTS` is already in config, just wasn't wired up for closed PRs

---

## Verification

1. `npx tsc --noEmit` — type-check passes
2. `npm test` — existing merge-conflict tests pass
3. Manual: set `PR_CLOSED_CHANNEL=topic_thread`, verify PR closed notifications land in the correct forum topic
4. Manual: set `PR_CLOSED_CHANNEL=dm`, verify PR closed notifications go to DM
5. Manual: set `PR_CLOSED_FORMAT=inline_buttons`, verify button appears in the notification
6. Manual: leave defaults unset, verify existing behavior unchanged
