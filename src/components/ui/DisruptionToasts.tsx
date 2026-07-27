"use client";

/**
 * Transient notifications for tidal disruption events. Subscribes to the
 * store rather than reading during render, so new toasts are queued from an
 * event callback.
 */

import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSimulationStore } from "@/lib/stores/simulation-store";

const TOAST_LIFETIME_MS = 5200;

interface Toast {
  key: string;
  disrupted: string;
  disruptor: string;
  fragmentCount: number;
}

export function DisruptionToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    return useSimulationStore.subscribe((state, prev) => {
      if (state.disruptionEvents === prev.disruptionEvents) return;
      const names = new Map(state.system.bodies.map((b) => [b.id, b.name] as const));
      const fresh: Toast[] = [];

      for (const event of state.disruptionEvents) {
        const key = `${event.timestamp}-${event.disruptedBody}`;
        if (seenRef.current.has(key)) continue;
        seenRef.current.add(key);
        fresh.push({
          key,
          // The victim is gone from `bodies` by now, so recover its name from
          // the fragments (which are named "<victim> fragment N").
          disrupted:
            event.fragments[0]?.name.replace(/ fragment \d+$/, "") ?? event.disruptedBody,
          disruptor: names.get(event.disruptorBody) ?? event.disruptorBody,
          fragmentCount: event.fragments.length,
        });
      }

      if (fresh.length === 0) return;
      setToasts((prevToasts) => [...prevToasts, ...fresh]);
      for (const toast of fresh) {
        setTimeout(() => {
          setToasts((prevToasts) => prevToasts.filter((t) => t.key !== toast.key));
        }, TOAST_LIFETIME_MS);
      }
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute left-1/2 top-4 z-30 flex -translate-x-1/2 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.key}
          className="flex items-center gap-2 rounded-md border border-amber-600/70 bg-amber-950/90 px-3 py-2 text-xs text-amber-100 shadow-xl backdrop-blur"
        >
          <AlertTriangle size={14} className="shrink-0 text-amber-400" />
          <span>
            <span className="font-semibold">{toast.disrupted}</span> tidally disrupted by{" "}
            <span className="font-semibold">{toast.disruptor}</span> — {toast.fragmentCount}{" "}
            fragments
          </span>
        </div>
      ))}
    </div>
  );
}
