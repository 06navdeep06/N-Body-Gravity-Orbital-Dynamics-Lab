"use client";

/**
 * Top-right dropdown: CSV / JSON export, PNG screenshot, WebM recording,
 * and share-link copying (with JSON-download fallback when the state is
 * too large for a URL). Shows a transient toast for feedback.
 */

import { Camera, Download, FileJson, FileSpreadsheet, Link2, Video } from "lucide-react";
import { useState } from "react";
import { exportCSV, exportJSON, exportPNG, recordWebM, type RecordingHandle } from "@/lib/utils/export";
import { encodeStateToURL } from "@/lib/utils/share";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const RECORD_SECONDS = 6;

// Module-level (not refs): only touched from event handlers, and there is
// a single ExportMenu instance in the app.
let activeRecording: RecordingHandle | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), 2600);
  };

  const withState = <T,>(fn: (state: ReturnType<typeof useSimulationStore.getState>["system"]) => T): T =>
    fn(useSimulationStore.getState().system);

  const handleCSV = () => {
    withState(exportCSV);
    showToast("CSV downloaded");
    setOpen(false);
  };

  const handleJSON = () => {
    withState(exportJSON);
    showToast("JSON downloaded");
    setOpen(false);
  };

  const handlePNG = () => {
    showToast(exportPNG() ? "Screenshot saved" : "Canvas not ready");
    setOpen(false);
  };

  const handleRecord = () => {
    if (recording) {
      activeRecording?.stop();
      return;
    }
    const handle = recordWebM(RECORD_SECONDS, () => {
      setRecording(false);
      showToast("Recording saved");
    });
    if (!handle) {
      showToast("Recording not supported here");
      return;
    }
    activeRecording = handle;
    setRecording(true);
    showToast(`Recording ${RECORD_SECONDS}s…`);
    setOpen(false);
  };

  const handleShare = async () => {
    const result = withState(encodeStateToURL);
    if (result.ok) {
      try {
        await navigator.clipboard.writeText(result.url);
        showToast("Share link copied to clipboard");
      } catch {
        showToast("Clipboard blocked — link in console");
        console.info("[share]", result.url);
      }
    } else {
      // Too many bodies to fit in a URL — download the state instead.
      withState(exportJSON);
      showToast("State too large for a URL — downloaded JSON instead");
    }
    setOpen(false);
  };

  const items = [
    { icon: FileSpreadsheet, label: "Export CSV", onClick: handleCSV },
    { icon: FileJson, label: "Export JSON", onClick: handleJSON },
    { icon: Camera, label: "Screenshot (PNG)", onClick: handlePNG },
    { icon: Video, label: recording ? "Stop recording" : `Record ${RECORD_SECONDS}s (WebM)`, onClick: handleRecord },
    { icon: Link2, label: "Copy share link", onClick: handleShare },
  ];

  return (
    <div className="pointer-events-auto relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Export data, images, video or a share link"
        className={`flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-3 text-xs font-medium shadow-lg ring-1 ring-zinc-700 max-sm:px-0 ${
          recording ? "bg-red-900/90 text-red-100" : "bg-zinc-900/90 text-zinc-100 hover:bg-zinc-800"
        }`}
      >
        <Download size={16} />
        {/* Label collapses to the icon on phones, where the chrome row is
            competing for width; `sr-only` keeps it for screen readers. */}
        <span className={recording ? undefined : "max-sm:sr-only"}>
          {recording ? "REC…" : "Export"}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 rounded-md border border-zinc-700 bg-zinc-950 p-1 shadow-xl">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={item.onClick}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-zinc-200 hover:bg-zinc-800"
            >
              <item.icon size={13} className="text-zinc-400" />
              {item.label}
            </button>
          ))}
        </div>
      )}

      {toast && (
        <div className="absolute right-0 top-full mt-12 w-max max-w-64 rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 text-[11px] text-zinc-100 shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
