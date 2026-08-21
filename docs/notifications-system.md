# Notifications Delivery System

This bot includes a generic notification routing system to allow per-event configuration of **Channels** (where messages go) and **Formats** (how they look).

## How it works

At its core, the primitive uses an `EventNotifier`. For a given event (e.g., "PR changes requested"), the `EventNotifier` looks up the configured `channel` and `format` from environment variables, retrieves the corresponding `ChannelAdapter` and `Formatter` from its registry, formats the payload, and dispatches it.

### Adding a new Channel

To add a new delivery channel (e.g., Slack, Discord, Email):
1. In `src/notifications/types.ts`, add your new channel ID to the `DeliveryChannel` type.
2. In `src/notifications/adapters.ts`, implement the `ChannelAdapter` interface for your new channel.
3. Register your new adapter in any `EventNotifier` instances that should support it (e.g., `src/notifications/prChangesRequested.ts`).

### Adding a new Format

To add a new message format (e.g., JSON payload, minimal text):
1. In `src/notifications/types.ts`, add your new format ID to the `DeliveryFormat` type.
2. In `src/notifications/formatters/<event>.ts`, implement the `Formatter<TPayload>` interface for the target event.
3. Register your new formatter with the corresponding `EventNotifier`.

### Adding a new Event

To wire up a new GitHub webhook event for configurable delivery:
1. Define the event's config payload in `src/config.ts` (e.g., `MY_EVENT_CHANNEL`, `MY_EVENT_FORMAT`).
2. Create `src/notifications/formatters/myEvent.ts` and build the supported formatters for this event's specific GitHub webhook payload type.
3. Create `src/notifications/myEvent.ts` exporting a new `EventNotifier` singleton with adapters and formatters registered.
4. In `src/github/webhooks.ts`, listen for the event and call `myEventNotifier.dispatch(event.payload, context)`.
