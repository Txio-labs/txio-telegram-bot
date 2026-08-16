import express, { Request, Response, NextFunction } from "express";
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

// Wire telegram webhook with secretToken authentication and resilient error handling
const grammyCallback = webhookCallback(bot, "express", {
  secretToken: config.telegramWebhookSecret,
});

app.use(config.telegramWebhookPath, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await grammyCallback(req, res);
  } catch (error) {
    console.error("Error in Telegram webhook middleware:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
});

app.listen(config.port, async () => {
  console.log(`txio-telegram-bot listening on :${config.port}`);
  const webhookUrl = `${config.publicUrl}${config.telegramWebhookPath}`;
  try {
    await bot.api.setWebhook(webhookUrl, {
      secret_token: config.telegramWebhookSecret,
    });
    console.log(`Telegram webhook registered at ${webhookUrl}`);
  } catch (error) {
    console.error("Failed to register Telegram webhook:", error);
  }
});
