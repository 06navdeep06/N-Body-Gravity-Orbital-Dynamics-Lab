/**
 * Data export: CSV / JSON downloads of the current SystemState, PNG
 * screenshots of the WebGL canvas, and WebM clips via MediaRecorder on the
 * canvas capture stream.
 */

import type { SystemState } from "@/lib/physics/types";
import { getGlCanvas } from "./canvas-ref";

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  URL.revokeObjectURL(url);
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function exportCSV(state: SystemState): void {
  const header = "name,mass,x,y,z,vx,vy,vz,radius,color";
  const rows = state.bodies.map((b) =>
    [
      // Quote the name so commas in body names can't break columns.
      `"${b.name.replaceAll('"', '""')}"`,
      b.mass,
      b.position.x,
      b.position.y,
      b.position.z,
      b.velocity.x,
      b.velocity.y,
      b.velocity.z,
      b.radius,
      b.color,
    ].join(",")
  );
  const csv = [header, ...rows].join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv" }), `simulation_state_${dateStamp()}.csv`);
}

export function exportJSON(state: SystemState): void {
  const json = JSON.stringify(state, null, 2);
  downloadBlob(new Blob([json], { type: "application/json" }), `simulation_state_${dateStamp()}.json`);
}

/** Captures the WebGL canvas as PNG. Requires preserveDrawingBuffer on the renderer. */
export function exportPNG(): boolean {
  const canvas = getGlCanvas();
  if (!canvas) return false;
  triggerDownload(canvas.toDataURL("image/png"), `simulation_${dateStamp()}.png`);
  return true;
}

export interface RecordingHandle {
  stop: () => void;
}

/**
 * Records the canvas for up to `seconds` (auto-stops) and downloads a WebM.
 * Returns a handle to stop early, or null if recording isn't possible.
 * `onDone` fires after the file download has been triggered.
 */
export function recordWebM(seconds: number, onDone?: () => void): RecordingHandle | null {
  const canvas = getGlCanvas();
  if (!canvas || typeof MediaRecorder === "undefined") return null;

  const stream = canvas.captureStream(30);
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) =>
    MediaRecorder.isTypeSupported(t)
  );
  if (!mimeType) return null;

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = () => {
    downloadBlob(new Blob(chunks, { type: "video/webm" }), `simulation_${dateStamp()}.webm`);
    stream.getTracks().forEach((t) => t.stop());
    onDone?.();
  };
  recorder.start();

  const timer = setTimeout(() => {
    if (recorder.state !== "inactive") recorder.stop();
  }, seconds * 1000);

  return {
    stop: () => {
      clearTimeout(timer);
      if (recorder.state !== "inactive") recorder.stop();
    },
  };
}
