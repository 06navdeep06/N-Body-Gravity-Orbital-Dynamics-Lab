"use client";

/**
 * Patched-conics transfer planner. Pick a departure and arrival body (both
 * orbiting the inferred primary); the panel shows the Hohmann Δv budget and
 * transfer time, compares it against bi-elliptic and a faster direct
 * (Lambert) trajectory, renders the transfer ellipse in the scene (via
 * `plannedTransfer` in the store — see TransferArc), and can execute the
 * departure burn by applying Δv1 prograde to the departure body.
 */

import { Rocket, X } from "lucide-react";
import { useMemo, useState } from "react";
import { inferPrimaryBody } from "@/lib/physics/orbital-elements";
import {
  biEllipticTransfer,
  hohmannTransfer,
  solveLambert,
} from "@/lib/physics/transfer-orbits";
import { length, scale, sub } from "@/lib/physics/vector";
import { useSimulationStore } from "@/lib/stores/simulation-store";

function fmt(x: number): string {
  return Number.isFinite(x) ? x.toPrecision(4) : "—";
}

function BudgetBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px] text-zinc-400">
        <span>{label}</span>
        <span className="font-mono">{fmt(value)}</span>
      </div>
      <div className="h-1.5 rounded bg-zinc-800">
        <div className="h-full rounded" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export function TransferPlanner() {
  const open = useSimulationStore((s) => s.transferPlannerOpen);
  const setOpen = useSimulationStore((s) => s.setTransferPlannerOpen);
  const bodies = useSimulationStore((s) => s.system.bodies);
  const G = useSimulationStore((s) => s.system.G);
  const setPlannedTransfer = useSimulationStore((s) => s.setPlannedTransfer);
  const updateBody = useSimulationStore((s) => s.updateBody);

  const [departureId, setDepartureId] = useState("");
  const [arrivalId, setArrivalId] = useState("");

  const primary = useMemo(() => inferPrimaryBody(bodies), [bodies]);
  const candidates = useMemo(
    () => bodies.filter((b) => primary && b.id !== primary.id && !b.isFixed),
    [bodies, primary]
  );

  const departure = candidates.find((b) => b.id === departureId);
  const arrival = candidates.find((b) => b.id === arrivalId);

  const plan = useMemo(() => {
    if (!primary || !departure || !arrival || departure.id === arrival.id) return null;
    const mu = G * primary.mass;
    const r1 = length(sub(departure.position, primary.position));
    const r2 = length(sub(arrival.position, primary.position));
    if (r1 < 1e-9 || r2 < 1e-9 || Math.abs(r1 - r2) < 1e-9) return null;

    const hohmann = hohmannTransfer(mu, r1, r2);
    const biElliptic = biEllipticTransfer(mu, r1, r2);

    // "Direct": a faster Lambert trajectory taking half the Hohmann time.
    let directDeltaV: number | null = null;
    const r1vec = sub(departure.position, primary.position);
    const r2vec = sub(arrival.position, primary.position);
    const lambert = solveLambert(r1vec, r2vec, hohmann.transferTime * 0.5, mu, true);
    if (lambert) {
      const vDep = sub(departure.velocity, primary.velocity);
      const vArr = sub(arrival.velocity, primary.velocity);
      directDeltaV = length(sub(lambert.v1, vDep)) + length(sub(vArr, lambert.v2));
    }

    return { mu, r1, r2, hohmann, biElliptic, directDeltaV };
  }, [primary, departure, arrival, G]);

  if (!open) return null;

  const handlePreview = () => {
    if (!plan || !primary || !departure || !arrival) return;
    setPlannedTransfer({
      departureId: departure.id,
      arrivalId: arrival.id,
      primaryId: primary.id,
      r1: plan.r1,
      r2: plan.r2,
      deltaV1: plan.hohmann.deltaV1,
      deltaV2: plan.hohmann.deltaV2,
      transferTime: plan.hohmann.transferTime,
    });
  };

  const handleExecute = () => {
    if (!plan || !departure) return;
    // Prograde burn: add deltaV1 along the departure body's velocity
    // direction (raising apoapsis when r2 > r1; the sign of the Hohmann
    // burn for an inward transfer is retrograde).
    const speed = length(departure.velocity);
    if (speed < 1e-12) return;
    const direction = scale(departure.velocity, 1 / speed);
    const sign = plan.r2 > plan.r1 ? 1 : -1;
    const dv = scale(direction, sign * plan.hohmann.deltaV1);
    updateBody(departure.id, {
      velocity: {
        x: departure.velocity.x + dv.x,
        y: departure.velocity.y + dv.y,
        z: departure.velocity.z + dv.z,
      },
    });
    handlePreview();
  };

  const maxDv = plan
    ? Math.max(plan.hohmann.totalDeltaV, plan.biElliptic.totalDeltaV, plan.directDeltaV ?? 0)
    : 0;

  return (
    <div className="pointer-events-auto absolute left-1/2 top-14 z-30 w-80 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-950/95 p-3 text-zinc-100 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Transfer Planner</h3>
        <button
          onClick={() => {
            setOpen(false);
            setPlannedTransfer(null);
          }}
          className="text-zinc-500 hover:text-zinc-200"
        >
          <X size={14} />
        </button>
      </div>

      {!primary ? (
        <p className="text-xs text-zinc-500">No primary body in this system.</p>
      ) : (
        <>
          <p className="mb-2 text-[10px] text-zinc-500">
            Orbits are treated as circular around <span className="text-zinc-300">{primary.name}</span>.
          </p>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <label className="text-[10px] text-zinc-400">
              Departure
              <select
                value={departureId}
                onChange={(e) => setDepartureId(e.target.value)}
                className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-1 py-1 text-xs text-zinc-100"
              >
                <option value="">select…</option>
                {candidates.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
            <label className="text-[10px] text-zinc-400">
              Arrival
              <select
                value={arrivalId}
                onChange={(e) => setArrivalId(e.target.value)}
                className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-1 py-1 text-xs text-zinc-100"
              >
                <option value="">select…</option>
                {candidates.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
          </div>

          {plan ? (
            <>
              <div className="mb-2 space-y-0.5 rounded bg-zinc-900/70 p-2 font-mono text-[10px]">
                <div className="flex justify-between"><span className="text-zinc-500">r1 → r2</span><span>{fmt(plan.r1)} → {fmt(plan.r2)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">Δv1 (departure burn)</span><span>{fmt(plan.hohmann.deltaV1)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">Δv2 (arrival burn)</span><span>{fmt(plan.hohmann.deltaV2)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">Transfer time</span><span>{fmt(plan.hohmann.transferTime)}</span></div>
              </div>

              <div className="mb-2 space-y-1.5">
                <BudgetBar label="Hohmann" value={plan.hohmann.totalDeltaV} max={maxDv} color="#22d3ee" />
                <BudgetBar label={`Bi-elliptic (via ${fmt(plan.biElliptic.intermediateRadius)})`} value={plan.biElliptic.totalDeltaV} max={maxDv} color="#a78bfa" />
                {plan.directDeltaV !== null && (
                  <BudgetBar label="Direct (Lambert, ½ time)" value={plan.directDeltaV} max={maxDv} color="#fb923c" />
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handlePreview}
                  className="flex-1 rounded bg-zinc-800 py-1.5 text-xs font-medium hover:bg-zinc-700"
                >
                  Preview Arc
                </button>
                <button
                  onClick={handleExecute}
                  className="flex flex-1 items-center justify-center gap-1 rounded bg-cyan-700 py-1.5 text-xs font-medium hover:bg-cyan-600"
                >
                  <Rocket size={12} />
                  Execute Transfer
                </button>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-zinc-500">
              Pick two different orbiting bodies to compute a transfer.
            </p>
          )}
        </>
      )}
    </div>
  );
}
