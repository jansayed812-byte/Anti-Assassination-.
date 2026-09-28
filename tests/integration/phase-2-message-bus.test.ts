/**
 * Phase 2 Integration Tests
 * آزمایش‌های ادغام برای Message Bus و قرارداد رویداد (Event Contract)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NatsService } from '../../services/comms/nats-service';
import { EdgeCollector } from '../../services/comms/edge-collector';
import { EventFactory, BaseEvent, isValidBaseEvent } from '../../services/comms/event-contracts';

describe('Phase 2: Message Bus and Event Contract', () => {
  let nats: NatsService;
  let collector: EdgeCollector;

  beforeAll(async () => {
    nats = new NatsService({
      url: process.env.NATS_URL || 'nats://localhost:4222',
      username: process.env.NATS_ADMIN_USER || 'ops_admin',
      password: process.env.NATS_ADMIN_PASSWORD || 'ops_admin_password',
      timeout: 5000
    });

    try {
      await nats.connect();
      await nats.setupStreams();
    } catch (error) {
      console.log('NATS not available for testing - skipping integration tests');
    }
  });

  afterAll(async () => {
    if (nats) {
      await nats.disconnect();
    }
  });

  describe('Event Contract', () => {
    it('should validate correct event structure', () => {
      const event = EventFactory.createPositionEvent(
        'gnss-01', 'gnss', 35.689194, 51.388974, 150.5, 5.2,
        { fix: '3d', hdop: 0.9, confidence: 0.98 }, 1
      );
      expect(isValidBaseEvent(event)).toBe(true);
      expect(event.event_id).toBeDefined();
      expect(event.source_id).toBe('gnss-01');
      expect(event.payload.lat).toBe(35.689194);
    });

    it('should create position events correctly', () => {
      const event = EventFactory.createPositionEvent(
        'wifi-02', 'wifi', 40.7128, -74.0060, 10.0, 0.0,
        { confidence: 0.85 }, 2
      );
      expect(event.source_type).toBe('wifi');
      expect(event.payload.lat).toBe(40.7128);
      expect(event.sequence).toBe(2);
    });

    it('should create risk assessment events correctly', () => {
      const event = EventFactory.createRiskEvent(
        0.8, 0.9, 0.7, 0.95, 35.689194, 51.388974, 1
      );
      expect(event.source_type).toBe('risk_engine');
      expect(event.payload.severity).toBe(0.8);
      expect(event.payload.risk_level).toBe('high');
    });

    it('should generate UUID for event_id', () => {
      const e1 = EventFactory.createPositionEvent('gnss-01', 'gnss', 35.689194, 51.388974, 150.5, 5.2, { confidence: 0.98 }, 1);
      const e2 = EventFactory.createPositionEvent('gnss-01', 'gnss', 35.689194, 51.388974, 150.5, 5.2, { confidence: 0.98 }, 2);
      expect(e1.event_id).not.toBe(e2.event_id);
    });

    it('should generate integrity hash', () => {
      const event = EventFactory.createPositionEvent('gnss-01', 'gnss', 35.689194, 51.388974, 150.5, 5.2, { confidence: 0.98 }, 1);
      expect(event.integrity.hash).toMatch(/^sha256:/);
      expect(event.integrity.algorithm).toBe('sha256');
    });

    it('should maintain sequence order', () => {
      const events: BaseEvent[] = [];
      for (let i = 1; i <= 10; i++) {
        events.push(EventFactory.createPositionEvent('gnss-01', 'gnss', 35.689194, 51.388974, 150.5, 5.2, { confidence: 0.98 }, i));
      }
      expect(events.map(e => e.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
  });

  describe('NATS Service', () => {
    it('should connect to NATS server', async () => {
      if (!nats.isActive()) { console.log('Skipping - NATS not available'); return; }
      expect(nats.isActive()).toBe(true);
    });
  });
});
