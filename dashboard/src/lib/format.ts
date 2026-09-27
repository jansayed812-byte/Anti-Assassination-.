import type { AlertLevel, RiskLevel } from '../api/types';

export type Lang = 'fa' | 'en';

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export const faN = (v: string | number) => String(v).replace(/\d/g, (d) => FA_DIGITS[+d]).replace(/\./g, '٫');
export const num = (lang: Lang, v: string | number) => (lang === 'fa' ? faN(v) : String(v));

/** Hue-driven tones (OKLCH), matching the design: foreground, tinted background, solid mark. */
export const fg = (h: number) => `oklch(0.82 0.12 ${h})`;
export const bgc = (h: number) => `oklch(0.34 0.08 ${h})`;
export const sol = (h: number) => `oklch(0.72 0.15 ${h})`;

export const SEV: Record<AlertLevel, { h: number; lvl: number; ack: number }> = {
  critical: { h: 25, lvl: 4, ack: 60 },
  error: { h: 55, lvl: 3, ack: 180 },
  warning: { h: 90, lvl: 2, ack: 600 },
  info: { h: 250, lvl: 1, ack: 1800 },
};

export const RISK_HUE: Record<RiskLevel, number> = { low: 150, medium: 90, high: 55, critical: 25 };
export const RISK_HEX: Record<RiskLevel, number> = { low: 0x6cbf7f, medium: 0xd2a93f, high: 0xe8904f, critical: 0xef7066 };

export const mmss = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const clock = (ts: number | string) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const km = (m: number) => (m / 1000).toFixed(1);
