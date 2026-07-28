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
app.use(config.telegramWebhookPath, webhookCallback(bot, "express"));

app.listen(config.port, async () => {
  console.log(`txio-telegram-bot listening on :${config.port}`);
  const webhookUrl = `${config.publicUrl}${config.telegramWebhookPath}`;
  try {
    await bot.api.setWebhook(webhookUrl);
    console.log(`Telegram webhook registered at ${webhookUrl}`);
  } catch (error) {
    console.error("Failed to register Telegram webhook:", error);
  }
});
