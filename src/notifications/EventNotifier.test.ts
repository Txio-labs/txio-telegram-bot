import { describe, it, expect, vi } from "vitest";
import { EventNotifier } from "./EventNotifier.js";
import { ChannelAdapter, Formatter, FormattedMessage } from "./types.js";

describe("EventNotifier", () => {
  it("routes payload to correct adapter and formatter based on config", async () => {
    const mockGetConfig = vi.fn().mockReturnValue({
      channel: "main_chat",
      format: "plain_text"
    });

    const notifier = new EventNotifier<{ some: string }>("testEvent", mockGetConfig);

    const mockFormatter: Formatter<{ some: string }> = {
      id: "plain_text",
      format: vi.fn().mockReturnValue({ text: "Hello from mock" })
    };

    const mockAdapter: ChannelAdapter = {
      id: "main_chat",
      send: vi.fn().mockResolvedValue(undefined)
    };

    notifier.registerFormatter(mockFormatter);
    notifier.registerAdapter(mockAdapter);

    await notifier.dispatch({ some: "data" }, { threadId: 123 });

    expect(mockGetConfig).toHaveBeenCalledOnce();
    expect(mockFormatter.format).toHaveBeenCalledWith({ some: "data" });
    expect(mockAdapter.send).toHaveBeenCalledWith(
      { text: "Hello from mock" },
      { threadId: 123 }
    );
  });

  it("throws if formatter is missing", async () => {
    const mockGetConfig = vi.fn().mockReturnValue({
      channel: "main_chat",
      format: "inline_buttons"
    });
    const notifier = new EventNotifier<{ some: string }>("testEvent", mockGetConfig);
    
    await expect(notifier.dispatch({ some: "data" })).rejects.toThrowError(/Formatter not found/);
  });

  it("throws if adapter is missing", async () => {
    const mockGetConfig = vi.fn().mockReturnValue({
      channel: "dm",
      format: "plain_text"
    });
    const notifier = new EventNotifier<{ some: string }>("testEvent", mockGetConfig);
    
    const mockFormatter: Formatter<{ some: string }> = {
      id: "plain_text",
      format: vi.fn().mockReturnValue({ text: "Hello" })
    };
    notifier.registerFormatter(mockFormatter);
    
    await expect(notifier.dispatch({ some: "data" })).rejects.toThrowError(/Adapter not found/);
  });
});
