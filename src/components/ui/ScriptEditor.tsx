"use client";

/**
 * Scenario scripting editor.
 *
 * Deliberately a plain textarea with a gutter rather than Monaco: Monaco is
 * ~5 MB of JS for what is a short-script authoring surface, and it would
 * dominate this app's bundle. The gutter tracks scroll so error line numbers
 * are still easy to find.
 */

import { Loader2, Play, X } from "lucide-react";
import { useRef, useState } from "react";
import { runScriptSandboxed } from "@/lib/scripting/run-script";
import { MAX_BODIES } from "@/lib/scripting/sandbox";
import { SCRIPT_TEMPLATES } from "@/lib/scripting/templates";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { useTimelineStore } from "@/lib/stores/timeline-store";

const API_HINT = [
  "api.addBody({ name, mass, position:[x,y,z], velocity:[vx,vy,vz], color, radius, isFixed, isBlackHole })",
  "api.removeBody(nameOrId) · api.setG(v) · api.setSoftening(v) · api.setTimeStep(v)",
  "api.circularOrbitVelocity(centralMass, radius) · api.escapeVelocity(centralMass, distance)",
  "api.bodyCount · api.log(...) · Math is available; DOM/network/timers are not.",
].join("\n");

export function ScriptEditor() {
  const open = useSimulationStore((s) => s.scriptEditorOpen);
  const setOpen = useSimulationStore((s) => s.setScriptEditorOpen);
  const setSystem = useSimulationStore((s) => s.setSystem);
  const pause = useSimulationStore((s) => s.pause);
  const clearTrails = useSimulationStore((s) => s.clearTrails);
  const clearHistory = useTimelineStore((s) => s.clearHistory);

  const [source, setSource] = useState(SCRIPT_TEMPLATES[0]!.source);
  const [templateId, setTemplateId] = useState(SCRIPT_TEMPLATES[0]!.id);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ message: string; line?: number } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  if (!open) return null;

  const lineCount = source.split("\n").length;

  const handleTemplate = (id: string) => {
    const template = SCRIPT_TEMPLATES.find((t) => t.id === id);
    if (!template) return;
    setTemplateId(id);
    setSource(template.source);
    setError(null);
    setSuccess(null);
  };

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setSuccess(null);
    const base = useSimulationStore.getState().system;
    const result = await runScriptSandboxed(source, base);
    setRunning(false);

    if (!result.ok) {
      setError({ message: result.error, line: result.line });
      return;
    }
    pause();
    setSystem(result.state);
    clearTrails();
    clearHistory();
    setSuccess(`Loaded ${result.bodyCount} bodies in ${result.elapsedMs} ms.`);
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/70 p-2 sm:p-6">
      <div className="flex h-full max-h-[680px] w-full max-w-3xl flex-col rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
          <h3 className="text-sm font-semibold text-zinc-100">Scenario Script</h3>
          <div className="flex items-center gap-2">
            <select
              value={templateId}
              onChange={(e) => handleTemplate(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200"
            >
              {SCRIPT_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-200">
              <X size={14} />
            </button>
          </div>
        </div>

        <p className="border-b border-zinc-800 px-3 py-1.5 text-[10px] text-zinc-500">
          {SCRIPT_TEMPLATES.find((t) => t.id === templateId)?.description}
        </p>

        {/* Gutter + textarea share a scroll position via onScroll. */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden font-mono text-[11px] leading-[1.45]">
          <div
            ref={gutterRef}
            className="select-none overflow-hidden border-r border-zinc-800 bg-zinc-900/60 px-2 py-2 text-right text-zinc-600"
            style={{ minWidth: 40 }}
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className={error?.line === i + 1 ? "bg-red-900/60 text-red-300" : ""}>
                {i + 1}
              </div>
            ))}
          </div>
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onScroll={(e) => {
              if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            spellCheck={false}
            wrap="off"
            className="min-h-0 flex-1 resize-none overflow-auto bg-transparent px-3 py-2 text-zinc-100 outline-none"
          />
        </div>

        {error && (
          <div className="border-t border-red-900 bg-red-950/60 px-3 py-2 text-[11px] text-red-200">
            <span className="font-semibold">
              Script error{error.line !== undefined ? ` (line ${error.line})` : ""}:
            </span>{" "}
            {error.message}
          </div>
        )}
        {success && (
          <div className="border-t border-emerald-900 bg-emerald-950/50 px-3 py-2 text-[11px] text-emerald-200">
            {success}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-3 py-2">
          <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre text-[9px] leading-snug text-zinc-500">
            {API_HINT}
          </pre>
          <button
            onClick={handleRun}
            disabled={running}
            className="flex shrink-0 items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {running ? "Running…" : "Run Script"}
          </button>
        </div>
        <p className="border-t border-zinc-800 px-3 py-1 text-[9px] text-zinc-600">
          Runs in a terminable worker: 5s time budget, {MAX_BODIES.toLocaleString()} body cap, no
          DOM/network access.
        </p>
      </div>
    </div>
  );
}
