/** Column and filter definitions for the Events and Requests panels (Epic #119, story 8.5). */
import { formatBytes, formatGameTime, formatWallTime } from './entries.js';
import type { PanelConfig } from './listPanel.js';

function field(data: unknown, key: string): unknown {
  return typeof data === 'object' && data !== null
    ? (data as Record<string, unknown>)[key]
    : undefined;
}

/** Whole seconds typed into a "from"/"to" box, as game ms. */
function seconds(v: string): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n * 1000 : undefined;
}

export const EVENTS_PANEL: PanelConfig = {
  noun: 'Engine events',
  kinds: ['engine'],
  columns: [
    { label: 'game time', width: '70px', cell: (r) => formatGameTime(r.gameMs) },
    { label: 'type', width: '170px', cell: (r) => r.type },
    { label: 'side', width: '50px', cell: (r) => r.side ?? '' },
    { label: 'unit', width: '110px', cell: (r) => r.unit ?? '' },
    { label: 'summary', width: 'auto', cell: (r) => r.summary },
  ],
  controls: [
    {
      id: 'type',
      label: 'type',
      type: 'select',
      options: (s) => s.distinct(['engine'], 'type'),
      apply: (f, v) => (f.type = v),
    },
    {
      id: 'side',
      label: 'side',
      type: 'select',
      options: (s) => s.distinct(['engine'], 'side'),
      apply: (f, v) => (f.side = v),
    },
    { id: 'unit', label: 'unit', type: 'text', apply: (f, v) => (f.unit = v) },
    { id: 'from', label: 'from (s)', type: 'number', apply: (f, v) => (f.fromMs = seconds(v)) },
    { id: 'to', label: 'to (s)', type: 'number', apply: (f, v) => (f.toMs = seconds(v)) },
  ],
};

export const REQUESTS_PANEL: PanelConfig = {
  noun: 'Requests',
  kinds: ['request'],
  columns: [
    { label: 'time', width: '95px', cell: (r) => formatWallTime(r.entry.ts) },
    { label: 'via', width: '40px', cell: (r) => String(field(r.entry.data, 'transport') ?? '') },
    { label: 'method', width: '90px', cell: (r) => r.type },
    { label: 'path', width: '260px', cell: (r) => String(field(r.entry.data, 'path') ?? '') },
    {
      label: 'status',
      width: '60px',
      cell: (r) => (field(r.entry.data, 'ok') === false ? 'error' : 'ok'),
    },
    {
      label: 'ms',
      width: '60px',
      cell: (r) => String(Math.round(Number(field(r.entry.data, 'durationMs') ?? NaN)) || ''),
    },
    {
      label: 'size',
      width: '120px',
      cell: (r) =>
        `${formatBytes(field(r.entry.data, 'bytes'))} → ${formatBytes(field(r.entry.data, 'responseBytes'))}`,
    },
    { label: 'correlation', width: 'auto', cell: (r) => r.entry.correlationId.slice(0, 8) },
  ],
  controls: [
    {
      id: 'transport',
      label: 'via',
      type: 'select',
      options: () => ['http', 'ws'],
      apply: (f, v) => (f.transport = v),
    },
    {
      id: 'outcome',
      label: 'status',
      type: 'select',
      options: () => ['ok', 'error'],
      apply: (f, v) => (f.outcome = v === 'error' ? 'error' : 'ok'),
    },
    {
      id: 'slow',
      label: 'min ms',
      type: 'number',
      apply: (f, v) => (f.minDurationMs = Number.isFinite(Number(v)) ? Number(v) : undefined),
    },
  ],
};
