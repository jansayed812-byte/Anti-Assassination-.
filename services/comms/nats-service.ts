/**
 * NATS JetStream Service
 */
import {
  connect, consumerOpts, createInbox, nanos,
  AckPolicy, DeliverPolicy, DiscardPolicy, RetentionPolicy, StorageType,
  NatsConnection, JetStreamClient, JetStreamManager,
} from 'nats';
import { BaseEvent, isValidBaseEvent } from './event-contracts';

interface NatsConfig {
  url: string;
  username?: string;
  password?: string;
  timeout?: number;
}

export class NatsService {
  private nc!: NatsConnection;
  private js!: JetStreamClient;
  private jsm!: JetStreamManager;
  private config: NatsConfig;
  private isConnected = false;

  constructor(config: NatsConfig) {
    this.config = {
      url: config.url || 'nats://localhost:4222',
      username: config.username,
      password: config.password,
      timeout: config.timeout || 5000
    };
  }

  async connect(): Promise<void> {
    try {
      this.nc = await connect({
        servers: [this.config.url],
        user: this.config.username,
        pass: this.config.password,
        timeout: this.config.timeout
      });
      this.js = this.nc.jetstream();
      this.jsm = await this.nc.jetstreamManager();
      this.isConnected = true;
      console.log('✓ NATS connected');
    } catch (error) {
      console.error('✗ NATS connection failed:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.nc.close();
      this.isConnected = false;
    }
  }

  async setupStreams(): Promise<void> {
    const streams = [
      { name: 'POSITION_DATA', subjects: ['position.gnss', 'position.wifi', 'position.ble', 'position.cellular'], maxAge: 7 * 24 * 60 * 60 * 1000 },
      { name: 'RISK_ASSESSMENT', subjects: ['risk.score', 'threat.assessment'], maxAge: 30 * 24 * 60 * 60 * 1000 },
      { name: 'ENVIRONMENTAL', subjects: ['environmental.conditions'], maxAge: 30 * 24 * 60 * 60 * 1000 },
      { name: 'ALERTS', subjects: ['alerts.system', 'alerts.security'], maxAge: 90 * 24 * 60 * 60 * 1000 },
      { name: 'SYSTEM_EVENTS', subjects: ['system.health', 'system.status'], maxAge: 7 * 24 * 60 * 60 * 1000 }
    ];
    for (const stream of streams) {
      try {
        await this.jsm.streams.add({ name: stream.name, subjects: stream.subjects, max_age: nanos(stream.maxAge), storage: StorageType.File, discard: DiscardPolicy.Old, retention: RetentionPolicy.Limits });
      } catch (error: any) {
        if (!error.message?.includes('STREAM_EXISTS')) throw error;
      }
    }
  }

  async publishEvent(event: BaseEvent, subject?: string): Promise<void> {
    if (!isValidBaseEvent(event)) throw new Error('Invalid event structure');
    const topic = subject || this.getTopicForEvent(event);
    await this.js.publish(topic, new TextEncoder().encode(JSON.stringify(event)));
  }

  async subscribe(subject: string, callback: (event: BaseEvent) => void): Promise<() => void> {
    const opts = consumerOpts();
    opts.deliverTo(createInbox());
    opts.manualAck();
    opts.ackExplicit();
    const sub = await this.js.subscribe(subject, opts);
    (async () => {
      for await (const message of sub) {
        try {
          const event = JSON.parse(new TextDecoder().decode(message.data)) as BaseEvent;
          if (isValidBaseEvent(event)) { callback(event); message.ack(); } else message.nak();
        } catch { message.nak(); }
      }
    })();
    return () => sub.unsubscribe();
  }

  async createConsumer(streamName: string, consumerName: string, filterSubject?: string): Promise<void> {
    try {
      await this.jsm.consumers.add(streamName, { durable_name: consumerName, filter_subject: filterSubject, deliver_policy: DeliverPolicy.All, ack_policy: AckPolicy.Explicit });
    } catch (error: any) {
      if (!error.message?.includes('CONSUMER_EXISTS')) throw error;
    }
  }

  async consumeEvents(streamName: string, consumerName: string, callback: (event: BaseEvent) => void): Promise<() => Promise<void>> {
    const consumer = await this.js.consumers.get(streamName, consumerName);
    const messages = await consumer.consume();
    (async () => {
      for await (const msg of messages) {
        try {
          const event = JSON.parse(new TextDecoder().decode(msg.data)) as BaseEvent;
          if (isValidBaseEvent(event)) { callback(event); msg.ack(); } else msg.nak();
        } catch { msg.nak(); }
      }
    })();
    return async () => { await messages.stop(); };
  }

  private getTopicForEvent(event: BaseEvent): string {
    switch (event.source_type) {
      case 'gnss': case 'wifi': case 'ble': case 'cellular': case 'ins': return `position.${event.source_type}`;
      case 'risk_engine': return 'risk.score';
      case 'environmental': return 'environmental.conditions';
      case 'alert_system': return 'alerts.system';
      case 'camera': return 'vision.detection';
      default: return `events.${event.source_type}`;
    }
  }

  isActive(): boolean { return this.isConnected; }

  async getStreamStats(): Promise<Record<string, any>> {
    try {
      const streams = await this.jsm.streams.list().next();
      const stats: Record<string, any> = {};
      for (const stream of streams) {
        const info = await this.jsm.streams.info(stream.config.name);
        stats[stream.config.name] = { messages: info.state.messages, bytes: info.state.bytes };
      }
      return stats;
    } catch { return {}; }
  }
}

let natsInstance: NatsService | null = null;

export async function getNatsService(config?: NatsConfig): Promise<NatsService> {
  if (!natsInstance) {
    natsInstance = new NatsService(config || { url: process.env.NATS_URL || 'nats://localhost:4222', username: process.env.NATS_ADMIN_USER, password: process.env.NATS_ADMIN_PASSWORD });
    await natsInstance.connect();
  }
  return natsInstance;
}
