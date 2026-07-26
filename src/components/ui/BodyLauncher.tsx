"use client";

import { Rocket } from "lucide-react";
import { useState } from "react";
import type { CelestialBody } from "@/lib/physics/types";
import { useSimulationStore } from "@/lib/stores/simulation-store";

let counter = 0;

const DEFAULT_COLOR = "#22d3ee";

export function BodyLauncher() {
  const addBody = useSimulationStore((s) => s.addBody);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("New Body");
  const [mass, setMass] = useState(1);
  const [radius, setRadius] = useState(0.5);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [position, setPosition] = useState({ x: 10, y: 0, z: 0 });
  const [velocity, setVelocity] = useState({ x: 0, y: 0, z: 5 });
  const [isFixed, setIsFixed] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    counter += 1;
    const body: CelestialBody = {
      id: `manual-${counter}`,
      name: name.trim() || `Body ${counter}`,
      mass,
      radius,
      color,
      position,
      velocity,
      isFixed,
    };
    addBody(body);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex items-center gap-2 rounded-md bg-zinc-900/90 px-3 py-2 text-xs font-medium text-zinc-100 shadow-lg ring-1 ring-zinc-700 hover:bg-zinc-800"
      >
        <Rocket size={14} />
        Add Body
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="pointer-events-auto w-64 space-y-2 rounded-lg border border-zinc-700 bg-zinc-950/95 p-3 text-xs text-zinc-100 shadow-xl"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Add Body</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-200">
          ×
        </button>
      </div>

      <label className="flex items-center justify-between gap-2">
        <span className="text-zinc-500">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-32 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1"
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        <span className="text-zinc-500">Color</span>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-6 w-10 rounded border border-zinc-700 bg-zinc-900"
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        <span className="text-zinc-500">Mass</span>
        <input
          type="number"
          value={mass}
          step={0.1}
          onChange={(e) => setMass(Number(e.target.value))}
          className="w-24 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-right"
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        <span className="text-zinc-500">Radius</span>
        <input
          type="number"
          value={radius}
          step={0.05}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="w-24 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-right"
        />
      </label>

      <div className="grid grid-cols-3 gap-1">
        {(["x", "y", "z"] as const).map((axis) => (
          <label key={axis} className="flex flex-col text-[10px] text-zinc-500">
            pos.{axis}
            <input
              type="number"
              value={position[axis]}
              onChange={(e) => setPosition({ ...position, [axis]: Number(e.target.value) })}
              className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-right"
            />
          </label>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {(["x", "y", "z"] as const).map((axis) => (
          <label key={axis} className="flex flex-col text-[10px] text-zinc-500">
            vel.{axis}
            <input
              type="number"
              value={velocity[axis]}
              onChange={(e) => setVelocity({ ...velocity, [axis]: Number(e.target.value) })}
              className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-right"
            />
          </label>
        ))}
      </div>

      <label className="flex items-center justify-between">
        <span className="text-zinc-500">Fixed</span>
        <input type="checkbox" checked={isFixed} onChange={(e) => setIsFixed(e.target.checked)} />
      </label>

      <button
        type="submit"
        className="flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 py-1.5 font-medium hover:bg-sky-500"
      >
        <Rocket size={14} />
        Launch
      </button>
    </form>
  );
}
