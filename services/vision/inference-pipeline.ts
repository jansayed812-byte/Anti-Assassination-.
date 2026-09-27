/**
 * Phase 8: Inference Pipeline (stub)
 */
import { EventEmitter } from 'events';
import type { FrameCapture, DetectionResult, BoundingBox } from './video-stream-manager';

export interface ModelConfig {
  model_path: string; labels: string[];
  confidence_threshold?: number; nms_threshold?: number;
  input_size?: { w: number; h: number }; use_gpu?: boolean;
}

export class InferencePipeline extends EventEmitter {
  private config: ModelConfig;
  private initialized = false;
  private queue: FrameCapture[] = [];
  private processing = false;

  constructor(config: ModelConfig) {
    super();
    this.config = { confidence_threshold: 0.5, nms_threshold: 0.4, input_size: { w: 640, h: 640 }, use_gpu: false, ...config };
  }

  async initialize(): Promise<void> { this.initialized = true; this.emit('ready'); }

  enqueue(frame: FrameCapture): void { this.queue.push(frame); if (!this.processing) this._processNext(); }

  private async _processNext(): Promise<void> {
    if (this.queue.length === 0) { this.processing = false; return; }
    this.processing = true;
    const frame = this.queue.shift()!;
    const t0 = Date.now();
    const detections = await this.detectObjects(frame);
    this.emit('result', { stream_id: frame.stream_id, frame_index: frame.frame_index, analyzed_at: new Date().toISOString(), detections, inference_ms: Date.now()-t0 } as DetectionResult);
    setImmediate(() => this._processNext());
  }

  protected async detectObjects(_frame: FrameCapture): Promise<BoundingBox[]> { return []; }
  isReady(): boolean { return this.initialized; }
  queueDepth(): number { return this.queue.length; }
}
