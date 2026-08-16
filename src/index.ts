import express from "express";
import { createNodeMiddleware } from "@octokit/webhooks";
import { webhookCallback } from "grammy";
import { config } from "./config.js";
import { webhooks } from "./github/webhooks.js";
import { bot } from "./telegram/client.js";

const app = express();

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

app.use(createNodeMiddleware(webhooks, { path: config.githubWebhookPath }));
app.use(config.telegramWebhookPath, express.json());
app.use(config.telegramWebhookPath, webhookCallback(bot, "express"));

const server = app.listen(config.port, async () => {
  console.log(`txio-telegram-bot listening on :${config.port}`);
  const webhookUrl = `${config.publicUrl}${config.telegramWebhookPath}`;
  try {
    await bot.api.setWebhook(webhookUrl);
    console.log(`Telegram webhook registered at ${webhookUrl}`);
  } catch (error) {
    console.error("Failed to register Telegram webhook:", error);
  }
});

const shutdownTimeoutMs = 10_000;
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} received, starting graceful shutdown`);

  const forceExitTimer = setTimeout(() => {
    console.error(`Graceful shutdown timed out after ${shutdownTimeoutMs}ms, forcing exit`);
    process.exit(1);
  }, shutdownTimeoutMs);

  server.close((error) => {
    clearTimeout(forceExitTimer);
    if (error) {
      console.error("Graceful shutdown failed:", error);
      process.exit(1);
    }

    console.log("Graceful shutdown complete");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
