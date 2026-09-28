/** Colour roles resolved from the active theme's CSS variables (the map needs concrete colour strings). */
import type { AlertLevel, RiskLevel } from '../api/types';

export const RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
export const RISK_VAR: Record<RiskLevel, string> = { low: 'var(--risk-low)', medium: 'var(--risk-medium)', high: 'var(--risk-high)', critical: 'var(--risk-critical)' };

export const SEV: Record<AlertLevel, { color: string; soft: string; chip: string; lvl: number; ack: number }> = {
  critical: { color: 'var(--danger)', soft: 'var(--danger-soft)', chip: 'chip-danger', lvl: 4, ack: 60 },
  error: { color: 'var(--risk-high)', soft: 'var(--warning-soft)', chip: 'chip-warning', lvl: 3, ack: 180 },
  warning: { color: 'var(--warning)', soft: 'var(--warning-soft)', chip: 'chip-warning', lvl: 2, ack: 600 },
  info: { color: 'var(--info)', soft: 'var(--info-soft)', chip: 'chip-info', lvl: 1, ack: 1800 },
};

export const RISK_CHIP: Record<RiskLevel, string> = { low: 'chip-success', medium: 'chip-warning', high: 'chip-warning', critical: 'chip-danger' };

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

export interface MapPalette {
  low: string; medium: string; high: string; critical: string; hazard: string; hazardInk: string; accent: string; friendly: string;
  danger: string; success: string; warning: string; info: string; text: string; ground: string; surface: string; line: string;
}

export function mapPalette(): MapPalette {
  return {
    low: cssVar('--risk-low'), medium: cssVar('--risk-medium'), high: cssVar('--risk-high'), critical: cssVar('--risk-critical'),
    hazard: cssVar('--hazard'), hazardInk: cssVar('--hazard-ink'), accent: cssVar('--accent'), friendly: cssVar('--friendly'),
    danger: cssVar('--danger'), success: cssVar('--success'), warning: cssVar('--warning'), info: cssVar('--info'),
    text: cssVar('--text'), ground: cssVar('--map-ground'), surface: cssVar('--surface'), line: cssVar('--line-strong'),
  };
}
