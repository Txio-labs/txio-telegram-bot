import express from "express";
import { createNodeMiddleware } from "@octokit/webhooks";
import { config } from "./config.js";
import { webhooks } from "./github/webhooks.js";

const app = express();

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

app.use(createNodeMiddleware(webhooks, { path: config.githubWebhookPath }));

app.listen(config.port, () => {
  console.log(`txio-telegram-bot listening on :${config.port}${config.githubWebhookPath}`);
});
