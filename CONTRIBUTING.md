# Contributing to txio-telegram-bot

First off, thank you for considering contributing! It's people like you that help keep the Txio team's GitHub activity visible and actionable in one place.

## How Can I Contribute?

### Reporting Bugs

Before creating a bug report, please check the [existing issues](https://github.com/Txio-labs/txio-telegram-bot/issues) — you might find you don't need to open a new one. When you do open one, please include:

* A clear and descriptive title
* The exact steps that reproduce the problem
* What you expected to happen vs. what actually happened
* Relevant logs (with any secrets/tokens redacted)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. Please include:

* A clear and descriptive title
* A step-by-step description of the suggested enhancement
* Why it would be useful to the team running this bot

### Pull Requests

* Do not include issue numbers in the PR title.
* Before merging, automated checks must pass (build/typecheck and tests).
* End all files with a newline.
* Keep PRs scoped to a single concern — this makes review faster and keeps `git blame` useful.

## Development Setup

```bash
npm install
npm run dev     # local development, runs src/index.ts via tsx with live reload
npm test        # run the unit test suite
npm run build && npm start   # production build
```

You'll need a `.env` file (copy `.env.example`) with a Telegram bot token, chat id, and a GitHub webhook secret — see the [README](./README.md#setup) for the full setup walkthrough.

If you're adding a webhook handler or formatter, add or update unit tests for it as part of your PR.

## Styleguides

### Git Commit Messages

* Use the present tense ("Add feature" not "Added feature")
* Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
* Limit the first line to 72 characters or less
* Reference issues and pull requests liberally after the first line

### Code Style

* TypeScript, ES modules (`"type": "module"` in `package.json`)
* Follow the existing pattern in `src/github/formatters.ts` for new event formatters: an icon, a linked repo/issue/PR, and an escaped-HTML body
* Keep webhook handlers in `src/github/webhooks.ts` thin — formatting logic belongs in `formatters.ts`, delivery logic belongs in `src/telegram/client.ts`
