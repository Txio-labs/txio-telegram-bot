import { DeliveryChannel, DeliveryFormat, FormattedMessage, DispatchContext, ChannelAdapter, Formatter } from "./types.js";

export class EventNotifier<TEventPayload> {
  private formatters = new Map<DeliveryFormat, Formatter<TEventPayload>>();
  private adapters = new Map<DeliveryChannel, ChannelAdapter>();

  constructor(
    public readonly eventType: string,
    private getConfig: () => { channel: DeliveryChannel; format: DeliveryFormat }
  ) {}

  registerFormatter(formatter: Formatter<TEventPayload>) {
    this.formatters.set(formatter.id, formatter);
    return this;
  }

  registerAdapter(adapter: ChannelAdapter) {
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  async dispatch(event: TEventPayload, context: DispatchContext = {}): Promise<void> {
    const config = this.getConfig();
    
    const formatter = this.formatters.get(config.format);
    if (!formatter) {
      throw new Error(`Formatter not found for format: ${config.format} on event ${this.eventType}`);
    }

    const adapter = this.adapters.get(config.channel);
    if (!adapter) {
      throw new Error(`Adapter not found for channel: ${config.channel} on event ${this.eventType}`);
    }

    const message = formatter.format(event);
    await adapter.send(message, context);
  }
}
