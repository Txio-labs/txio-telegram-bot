# txio-telegram-bot

Ops bot for the Txio team. Listens for GitHub webhook events (issues, pull
requests, CI runs, deployments) and posts a formatted notification into a
Telegram channel. It does not accept commands or answer queries — it's a
one-way notifier.

## Setup

1. **Create the bot**: message [@BotFather](https://t.me/BotFather) on
   Telegram, run `/newbot`, and copy the token into `TELEGRAM_BOT_TOKEN`.
2. **Get the channel id**: add the bot as an admin of the target channel,
   post any message, then check
   `https://api.telegram.org/bot<TOKEN>/getUpdates` for the chat id
   (channel ids look like `-100xxxxxxxxxx`). Set `TELEGRAM_CHAT_ID`.
3. **Configure the GitHub webhook**: in the repo's Settings > Webhooks, add
   a webhook pointing at `https://<host>/webhooks/github`, content type
   `application/json`, and a secret matching `GITHUB_WEBHOOK_SECRET`.
   Subscribe to: Issues, Pull requests, Workflow runs, Deployment statuses.
4. Copy `.env.example` to `.env` and fill in the values above.

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
