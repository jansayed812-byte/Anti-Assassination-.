/**
 * Threat detections awaiting human validation. A confirmed detection becomes an incident in the
 * risk model; uploaded images go through the vision InferencePipeline.
 */
import { EventEmitter } from 'events';
import { InferencePipeline } from '../../vision/inference-pipeline';
import type { DetectionResult } from '../../vision/video-stream-manager';
import type { RiskModel } from './risk';
import type { RiskLevel } from '../../threat/risk-engine';
import type { Tri } from '../i18n/types';

export interface Detection {
  id: string; label: Tri; source: string; confidence: number; observed_at: string;
  lat: number; lon: number; severity: RiskLevel; radius_m: number;
  status: 'pending' | 'confirmed' | 'rejected'; decided_by?: string; incident_id?: string;
}

export class DetectionError extends Error { constructor(public code: string, message: string) { super(message); } }

export class DetectionService extends EventEmitter {
  private items = new Map<string, Detection>();
  private pipeline = new InferencePipeline({ model_path: 'models/yolov8n.onnx', labels: ['person', 'vehicle', 'weapon'] });
  private frame = 0;

  constructor(private risk: RiskModel, seed: Detection[]) {
    super();
    for (const d of seed) this.items.set(d.id, d);
    void this.pipeline.initialize();
  }

  list(): Detection[] { return [...this.items.values()]; }

  decide(id: string, decision: 'confirm' | 'reject', by: string): Detection {
    const d = this.items.get(id);
    if (!d) throw new DetectionError('detection_not_found', `detection not found: ${id}`);
    if (d.status !== 'pending') throw new DetectionError('already_decided', `detection ${id} already ${d.status}`);
    let next: Detection = { ...d, status: decision === 'confirm' ? 'confirmed' : 'rejected', decided_by: by };
    if (decision === 'confirm') {
      const inc = this.risk.add({ type: d.label.en, severity: d.severity, location: { lat: d.lat, lon: d.lon }, radius_m: d.radius_m, confidence: d.confidence, evidence: [d.source, `detection:${d.id}`], source: 'human_validated', human_validation_status: 'confirmed' });
      next = { ...next, incident_id: inc.incident_id };
    }
    this.items.set(id, next);
    this.emit('changed', next);
    return next;
  }

  /** Runs an uploaded image through the inference pipeline and returns its result. */
  analyzeImage(data: Buffer, source = 'upload'): Promise<DetectionResult & { model_ready: boolean }> {
    const frame_index = ++this.frame;
    return new Promise((resolve) => {
      const onResult = (r: DetectionResult) => {
        if (r.frame_index !== frame_index || r.stream_id !== source) return;
        this.pipeline.off('result', onResult);
        resolve({ ...r, model_ready: this.pipeline.isReady() });
      };
      this.pipeline.on('result', onResult);
      this.pipeline.enqueue({ stream_id: source, frame_index, captured_at: new Date().toISOString(), width: 0, height: 0, data });
    });
  }
}
