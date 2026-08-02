export type ScanConcern = {
  id: string;
  area: "skin" | "hair";
  score: number;
  severity: "mild" | "moderate" | "marked";
  confidence: number;
};

export type ScanWarning = { code: string; hint?: string };

export type ScanResult = {
  version: string;
  ok: boolean;
  reason?: string;
  confidence: number;
  framesUsed?: number;
  capture?: Record<string, unknown>;
  skin?: {
    available: boolean;
    reason?: string;
    scores: Record<string, number>;
    raw?: unknown;
    [key: string]: unknown;
  };
  hair?: {
    available: boolean;
    reason?: string;
    scores: Record<string, number>;
    raw?: unknown;
    [key: string]: unknown;
  };
  concerns: ScanConcern[];
  completeness?: {
    skin: { ran: string[]; missing: string[] };
    hair: { ran: string[]; missing: string[] };
    ratio: number;
    reasons: string[];
  };
  warnings: ScanWarning[];
  notes: string[];
};

export type Scanner = {
  scan(source: CanvasImageSource, opts?: { debug?: boolean }): Promise<ScanResult>;
  scanImage(source: CanvasImageSource, opts?: { debug?: boolean }): ScanResult;
  close(): void;
  hasSegmenter(): boolean;
};

export function createScanner(opts?: { frames?: number; frameDelayMs?: number }): Promise<Scanner>;
export const WORKING_LONG_EDGE: number;
export const CONTRACT_VERSION: string;
