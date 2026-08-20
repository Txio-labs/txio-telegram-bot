# Requirements Document

## Introduction

This feature adds optional label-based filtering to each per-repo routing destination in the txio-telegram-bot. Currently, every GitHub event for a subscribed repository is forwarded to the configured Telegram chat/topic without any way to restrict delivery by issue or pull request labels. The feature extends the `RepoRoute` configuration schema with an optional `labels` allowlist per event-category destination. When a `labels` allowlist is present, only events whose payload contains at least one matching label are forwarded; all other events are silently dropped at that destination. Destinations without a `labels` key are unaffected, preserving full backward compatibility. Events that do not carry labels at all (e.g. `workflow_run`, `deployment_status`) are treated as a filter no-op and always pass through.

## Glossary

- **Label_Filter**: The subsystem responsible for comparing payload labels against a configured allowlist and deciding whether an event should be forwarded to a destination.
- **RepoRoute**: A per-repository routing configuration entry in `REPO_ROUTING_CONFIG_PATH` that maps event categories to Telegram chat/topic destinations.
- **Destination**: A resolved Telegram target consisting of a `chatId` and an optional `threadId`, derived from a `RepoRoute` entry.
- **Allowlist**: An optional `labels` array on an event-category key inside a `RepoRoute` entry. When present, only events with at least one label in common with the allowlist are forwarded.
- **Payload_Labels**: The array of label name strings extracted from a GitHub webhook payload for issues (`issue.labels`) or pull requests (`pull_request.labels`).
- **Label-Bearing Event**: A GitHub webhook event whose payload includes a `labels` array — specifically `issues.*` and `pull_request.*` events.
- **Non-Label-Bearing Event**: A GitHub webhook event whose payload does not include a `labels` array — specifically `workflow_run.*` and `deployment_status.*` events.
- **Config_Loader**: The module (`src/config.ts`) responsible for reading, parsing, and validating the JSON routing configuration file.
- **Webhook_Handler**: The module (`src/github/webhooks.ts`) responsible for receiving GitHub webhook events and dispatching Telegram notifications.

## Requirements

### Requirement 1: Extend Routing Configuration Schema with Label Allowlist

**User Story:** As a team operator, I want to add an optional `labels` allowlist to each event-category entry in the per-repo routing config, so that I can restrict which labeled issues or pull requests trigger notifications to a given destination.

#### Acceptance Criteria

1. THE `Config_Loader` SHALL accept an optional `labels` key of type `string[]` on each event-category entry (`issues`, `pullRequests`, `ci`, `deploys`) within a `RepoRoute` object, and SHALL retain the validated `labels` value in the returned `RepoRoute` so that downstream filtering can use it.
2. WHEN the `labels` key is present on an event-category entry, THE `Config_Loader` SHALL validate that its value is a non-empty array where every element is a string.
3. IF the `labels` key is present but its value is not an array, or is an array that contains one or more non-string elements, THEN THE `Config_Loader` SHALL throw an error whose message contains the repository key and the event-category field name.
4. IF the `labels` key is present and its value is an empty array (`[]`), THEN THE `Config_Loader` SHALL throw an error whose message contains the repository key and the event-category field name.
5. WHEN the `labels` key is absent from an event-category entry, THE `Config_Loader` SHALL treat that entry as having no label filter, preserving existing behavior.
6. THE `Config_Loader` SHALL continue to accept all existing `RepoRoute` keys (`chatId`, `issues`, `pullRequests`, `ci`, `deploys`) without modification.

### Requirement 2: Label-Based Gate for Issues Events

**User Story:** As a team operator, I want issues notifications to be suppressed unless the issue carries at least one label that matches the destination's allowlist, so that only labeled issues of interest reach the configured topic.

#### Acceptance Criteria

1. WHEN an `issues.*` event is received and the resolved `Destination` has a `labels` allowlist configured, THE `Label_Filter` SHALL derive `Payload_Labels` as the list of `name` string values from the `labels` array in the issue payload, and SHALL compare each entry in `Payload_Labels` against the allowlist using a case-sensitive exact match.
2. WHEN at least one label in `Payload_Labels` matches an entry in the allowlist, THE `Webhook_Handler` SHALL forward the issues notification to the `Destination`.
3. WHEN no label in `Payload_Labels` matches any entry in the allowlist, THE `Webhook_Handler` SHALL not send a message to that `Destination` and SHALL not raise an error.
4. WHEN an `issues.*` event is received and the resolved `Destination` has no `labels` allowlist configured, THE `Webhook_Handler` SHALL send the notification message to the resolved destination without performing any label evaluation.
5. WHEN an `issues.*` event payload contains zero labels and the `Destination` has a `labels` allowlist configured, THE `Webhook_Handler` SHALL not forward the notification to that `Destination`.

### Requirement 3: Label-Based Gate for Pull Request Events

**User Story:** As a team operator, I want pull request notifications to be suppressed unless the pull request carries at least one label that matches the destination's allowlist, so that only relevant pull requests are surfaced in a given topic.

#### Acceptance Criteria

1. WHEN a `pull_request.*` event is received and the resolved `Destination` has a `labels` allowlist configured, THE `Label_Filter` SHALL derive `Payload_Labels` as the list of `name` string values from the `labels` array in the pull request payload, and SHALL compare each entry against the allowlist using a case-sensitive exact match.
2. WHEN at least one label in `Payload_Labels` matches an entry in the allowlist, THE `Webhook_Handler` SHALL forward the pull request notification to the `Destination`.
3. WHEN no label in `Payload_Labels` matches any entry in the allowlist, THE `Webhook_Handler` SHALL not send a message to that `Destination` and SHALL not raise an error.
4. WHEN a `pull_request.*` event is received and the resolved `Destination` has no `labels` allowlist configured, THE `Webhook_Handler` SHALL send the notification message to the resolved destination without performing any label evaluation.
5. WHEN a `pull_request.*` event payload contains zero labels and the `Destination` has a `labels` allowlist configured, THE `Webhook_Handler` SHALL not forward the notification to that `Destination`.
6. WHEN a `pull_request.opened`, `pull_request.synchronize`, or `pull_request.reopened` event triggers a merge-conflict check and the resolved `Destination` has a `labels` allowlist configured, and no label in `Payload_Labels` matches any entry in the allowlist, THE `Webhook_Handler` SHALL not send the merge-conflict alert to that `Destination`.
7. WHEN a `pull_request.opened`, `pull_request.synchronize`, or `pull_request.reopened` event triggers a merge-conflict check and the resolved `Destination` has a `labels` allowlist configured, and at least one label in `Payload_Labels` matches an entry in the allowlist, THE `Webhook_Handler` SHALL send the merge-conflict alert to the `Destination`.

### Requirement 4: No-Op Filtering for Non-Label-Bearing Events

**User Story:** As a team operator, I want CI and deployment notifications to be unaffected by any label allowlist configuration, so that infrastructure events are never accidentally suppressed.

#### Acceptance Criteria

1. WHEN a `workflow_run.completed` event is received and the `ci` destination has a `labels` allowlist configured, THE `Webhook_Handler` SHALL not evaluate the allowlist and SHALL forward the notification subject to its existing non-label conditions (e.g. formatter producing a non-empty message).
2. WHEN a `workflow_run.completed` event is received and the `ci` destination has no `labels` allowlist configured, THE `Webhook_Handler` SHALL forward the notification subject to its existing non-label conditions (no regression).
3. WHEN a `deployment_status.created` event is received and the `deploys` destination has a `labels` allowlist configured, THE `Webhook_Handler` SHALL not evaluate the allowlist and SHALL forward the notification subject to its existing non-label conditions.
4. WHEN a `deployment_status.created` event is received and the `deploys` destination has no `labels` allowlist configured, THE `Webhook_Handler` SHALL forward the notification subject to its existing non-label conditions (no regression).

### Requirement 5: Debug Logging for Suppressed Events

**User Story:** As a developer operating the bot, I want suppressed events to produce a debug-level log entry, so that I can diagnose misconfigured allowlists without missing notifications going unnoticed.

#### Acceptance Criteria

1. WHEN the `Label_Filter` suppresses an event because no label matches the allowlist, THE `Webhook_Handler` SHALL emit a log entry at `debug` level that includes: the repository full name, the GitHub event name and action combined (e.g. `issues.opened`), the delivery ID from the webhook headers (or the string `"unknown"` if absent), the payload labels, and the configured allowlist.
2. WHEN the `Label_Filter` allows an event through, THE `Webhook_Handler` SHALL not emit a log entry specifically for the filter-pass decision (other handler logs are unaffected).

### Requirement 6: Configuration File Documentation

**User Story:** As a contributor, I want `repo-routing.example.json` updated with a `labels` allowlist example, so that I can understand the new schema without reading source code.

#### Acceptance Criteria

1. THE `repo-routing.example.json` file SHALL include at least one example `RepoRoute` entry that demonstrates the `labels` key set to an array of one or more strings on a named event-category field (`issues`, `pullRequests`, `ci`, or `deploys`).
2. THE `repo-routing.example.json` file SHALL preserve all four existing repo entries (`org/repo-a`, `org/repo-b`, `org/repo-c`, `org/repo-d`, or whichever are currently present) unchanged.

### Requirement 7: README Documentation

**User Story:** As a team operator, I want the README updated with label filtering instructions, so that I can configure the feature without reading source code.

#### Acceptance Criteria

1. THE `README.md` SHALL document the `labels` key within the per-repo routing configuration section, describing it as an optional array of strings and stating that matching is case-sensitive and exact.
2. THE `README.md` SHALL include an example JSON snippet demonstrating the `labels` allowlist set to an array of one or more strings on an event-category entry.
3. THE `README.md` SHALL document that when an event has zero labels and an allowlist is configured, the event is not forwarded to that destination.
4. THE `README.md` SHALL document that events which carry no `labels` field in their payload — specifically CI (`workflow_run.completed`) and deployment (`deployment_status.created`) events — are always forwarded and are unaffected by any `labels` allowlist.
