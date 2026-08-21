import { ChannelAdapter, DispatchContext, FormattedMessage } from "./types.js";
import { sendMessage, notifyChannel } from "../telegram/client.js";

export const mainChatAdapter: ChannelAdapter = {
  id: "main_chat",
  async send(message: FormattedMessage, _context: DispatchContext) {
    await notifyChannel(message.text, undefined, {
      parseMode: message.parseMode,
      replyMarkup: message.replyMarkup,
    });
  }
};

export const topicThreadAdapter: ChannelAdapter = {
  id: "topic_thread",
  async send(message: FormattedMessage, context: DispatchContext) {
    await notifyChannel(message.text, context.threadId, {
      parseMode: message.parseMode,
      replyMarkup: message.replyMarkup,
    });
  }
};

export const dmAdapter: ChannelAdapter = {
  id: "dm",
  async send(message: FormattedMessage, context: DispatchContext) {
    if (!context.dmChatId) {
      console.warn("DM channel selected but no dmChatId provided in context, falling back to main chat.");
      await notifyChannel(message.text, undefined, {
        parseMode: message.parseMode,
        replyMarkup: message.replyMarkup,
      });
      return;
    }
    await sendMessage(context.dmChatId, message.text, undefined, {
      parseMode: message.parseMode,
      replyMarkup: message.replyMarkup,
    });
  }
};
