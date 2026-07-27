/**
 * Main-thread driver for the script worker: spawns a fresh worker per run,
 * races it against the time budget, and terminates it on timeout so a runaway
 * loop can't survive.
 */

import type { SystemState } from "@/lib/physics/types";
import { TIMEOUT_MS, type ScriptResult } from "./sandbox";
import type { ScriptRunRequest, ScriptRunResponse } from "./script.worker";

let requestCounter = 0;

/**
 * Runs `source` in a terminable worker. Always resolves — script failures come
 * back as `{ ok: false }` rather than rejections.
 */
export function runScriptSandboxed(source: string, base: SystemState): Promise<ScriptResult> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./script.worker.ts", import.meta.url));
    } catch (error) {
      resolve({
        ok: false,
        error: `could not start the script worker: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return;
    }

    let settled = false;
    const finish = (result: ScriptResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: `script exceeded its ${TIMEOUT_MS / 1000}s time budget and was terminated`,
      });
    }, TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<ScriptRunResponse>) => finish(event.data.result);
    worker.onerror = (event) =>
      finish({ ok: false, error: event.message || "script worker crashed" });

    requestCounter += 1;
    worker.postMessage({
      type: "RUN",
      requestId: requestCounter,
      source,
      base,
    } satisfies ScriptRunRequest);
  });
}
