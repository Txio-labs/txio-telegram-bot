import type { InlineKeyboard } from "grammy";

export type DeliveryChannel = "main_chat" | "topic_thread" | "dm";
export type DeliveryFormat = "plain_text" | "markdown_summary" | "inline_buttons";

export interface EventDeliveryConfig {
  channel: DeliveryChannel;
  format: DeliveryFormat;
}

export interface FormattedMessage {
  text: string;
  parseMode?: "HTML";
  replyMarkup?: InlineKeyboard;
}

export interface DispatchContext {
  threadId?: number;
  dmChatId?: string | number;
}

export interface ChannelAdapter {
  id: DeliveryChannel;
  send(message: FormattedMessage, context: DispatchContext): Promise<void>;
}

export interface Formatter<TEventPayload> {
  id: DeliveryFormat;
  format(event: TEventPayload): FormattedMessage;
}
