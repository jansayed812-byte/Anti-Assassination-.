/**
 * Phase 8: Video Stream Manager
 */
import { EventEmitter } from 'events';

export interface StreamConfig {
  stream_id: string; source_url: string;
  fps_target?: number; resolution?: { w: number; h: number }; inference_enabled?: boolean;
}

export interface FrameCapture {
  stream_id: string; frame_index: number; captured_at: string;
  width: number; height: number; data: Buffer;
}

export interface DetectionResult {
  stream_id: string; frame_index: number; analyzed_at: string;
  detections: BoundingBox[]; inference_ms: number;
}

export interface BoundingBox {
  label: string; confidence: number; x: number; y: number; w: number; h: number;
}

export class VideoStreamManager extends EventEmitter {
  private streams = new Map<string, StreamConfig>();
  private frameCounters = new Map<string, number>();

  addStream(config: StreamConfig): void {
    this.streams.set(config.stream_id, { fps_target: 30, resolution: { w: 3840, h: 2160 }, inference_enabled: true, ...config });
    this.frameCounters.set(config.stream_id, 0);
    this.emit('stream_added', config.stream_id);
  }

  removeStream(streamId: string): void { this.streams.delete(streamId); this.frameCounters.delete(streamId); this.emit('stream_removed', streamId); }
  getStream(streamId: string): StreamConfig | undefined { return this.streams.get(streamId); }
  listStreams(): StreamConfig[] { return Array.from(this.streams.values()); }

  ingestFrame(frame: FrameCapture): void {
    const count = (this.frameCounters.get(frame.stream_id) ?? 0) + 1;
    this.frameCounters.set(frame.stream_id, count);
    if (this.streams.get(frame.stream_id)?.inference_enabled) this.emit('frame_ready', frame);
  }

  publishDetection(result: DetectionResult): void { this.emit('detection', result); }
  getFrameCount(streamId: string): number { return this.frameCounters.get(streamId) ?? 0; }
}
