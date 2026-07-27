/**
 * Message protocol for the analysis worker (Lyapunov exponents and chaos
 * maps). Kept free of `webworker`-lib types so main-thread code can import
 * it — same split as worker-protocol.ts.
 */

import type { ChaosMapSpec, LyapunovResult } from "./lyapunov";
import type { SystemState } from "./types";

export interface LyapunovRequest {
  type: "LYAPUNOV";
  requestId: number;
  state: SystemState;
  targetId: string;
  steps?: number;
}

export interface ChaosMapRequest {
  type: "CHAOS_MAP";
  requestId: number;
  state: SystemState;
  spec?: Partial<ChaosMapSpec>;
}

/** Cancels an in-flight chaos map sweep. */
export interface CancelRequest {
  type: "CANCEL";
  requestId: number;
}

export type AnalysisRequest = LyapunovRequest | ChaosMapRequest | CancelRequest;

export interface LyapunovResponse {
  type: "LYAPUNOV_RESULT";
  requestId: number;
  targetId: string;
  result: LyapunovResult | null;
}

/** One row of the chaos map, streamed as it completes. */
export interface ChaosMapRowResponse {
  type: "CHAOS_MAP_ROW";
  requestId: number;
  gridSize: number;
  /** Row index along the speed-factor axis. */
  row: number;
  /** Lyapunov exponent per column; NaN where the sample failed. */
  exponents: number[];
  spec: ChaosMapSpec;
}

export interface ChaosMapDoneResponse {
  type: "CHAOS_MAP_DONE";
  requestId: number;
}

export interface AnalysisErrorResponse {
  type: "ERROR";
  requestId: number;
  message: string;
}

export type AnalysisResponse =
  | LyapunovResponse
  | ChaosMapRowResponse
  | ChaosMapDoneResponse
  | AnalysisErrorResponse;
