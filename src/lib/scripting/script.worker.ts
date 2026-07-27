/**
 * Runs user scenario scripts in a dedicated worker.
 *
 * The worker exists specifically so the time budget is *enforceable*: a
 * `while (true) {}` in a main-thread `Function()` sandbox would wedge the tab
 * with no way to interrupt it, whereas a worker can simply be terminated (see
 * runScriptSandboxed in ./run-script.ts). It also means a script can't touch
 * the DOM even if it escapes the shadowed-globals wrapper, because a worker
 * scope has no `document` at all.
 *
 * Type-checked against the "webworker" lib (tsconfig.worker.json).
 */

/// <reference lib="webworker" />

import { runScript, type ScriptResult } from "./sandbox";
import type { SystemState } from "@/lib/physics/types";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

export interface ScriptRunRequest {
  type: "RUN";
  requestId: number;
  source: string;
  base: SystemState;
}

export interface ScriptRunResponse {
  type: "RESULT";
  requestId: number;
  result: ScriptResult;
}

ctx.onmessage = (event: MessageEvent<ScriptRunRequest>) => {
  const { requestId, source, base } = event.data;
  let result: ScriptResult;
  try {
    result = runScript(source, base);
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  ctx.postMessage({ type: "RESULT", requestId, result } satisfies ScriptRunResponse);
};

export {};
