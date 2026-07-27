/** Starter scripts for the scenario editor. */

export interface ScriptTemplate {
  id: string;
  name: string;
  description: string;
  source: string;
}

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: "ring",
    name: "Ring of Bodies",
    description: "N bodies on a circle, each given its local circular-orbit velocity.",
    source: `// A ring of small bodies orbiting a central mass.
const CENTRAL_MASS = 2000;
const COUNT = 120;
const RADIUS = 30;

api.setG(1);
api.setTimeStep(0.005);
api.setSoftening(0.08);

api.addBody({
  name: 'Central Mass',
  mass: CENTRAL_MASS,
  position: [0, 0, 0],
  velocity: [0, 0, 0],
  color: '#fbbf24',
  radius: 2.5,
  isFixed: true,
});

for (let i = 0; i < COUNT; i++) {
  const angle = (2 * Math.PI * i) / COUNT;
  const v = api.circularOrbitVelocity(CENTRAL_MASS, RADIUS);
  api.addBody({
    name: 'ring_' + i,
    mass: 0.05,
    position: [RADIUS * Math.cos(angle), 0, RADIUS * Math.sin(angle)],
    // Tangential: perpendicular to the radius, counter-clockwise from above.
    velocity: [v * Math.sin(angle), 0, -v * Math.cos(angle)],
    color: '#7dd3fc',
    radius: 0.25,
  });
}
`,
  },
  {
    id: "cluster",
    name: "Random Cluster",
    description: "Gaussian-distributed positions and velocities — watch it virialize.",
    source: `// A self-gravitating cluster with Gaussian positions and velocities.
const COUNT = 200;
const SPREAD = 18;
const VELOCITY_SPREAD = 1.6;

api.setG(1);
api.setTimeStep(0.004);
api.setSoftening(0.3);

// Box-Muller: uniform -> standard normal.
function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

for (let i = 0; i < COUNT; i++) {
  api.addBody({
    name: 'star_' + i,
    mass: 0.6 + Math.random() * 1.4,
    position: [gaussian() * SPREAD, gaussian() * SPREAD * 0.4, gaussian() * SPREAD],
    velocity: [
      gaussian() * VELOCITY_SPREAD,
      gaussian() * VELOCITY_SPREAD * 0.4,
      gaussian() * VELOCITY_SPREAD,
    ],
    color: '#c4b5fd',
    radius: 0.3,
  });
}
`,
  },
  {
    id: "galaxies",
    name: "Colliding Galaxies",
    description: "Two rotating disks on approach trajectories.",
    source: `// Two rotating disk galaxies on a collision course.
api.setG(1);
api.setTimeStep(0.003);
api.setSoftening(0.5);

function makeDisk(cx, cz, vx, coreMass, count, color, spin) {
  api.addBody({
    name: 'core_' + cx,
    mass: coreMass,
    position: [cx, 0, cz],
    velocity: [vx, 0, 0],
    color: '#fde68a',
    radius: 2,
  });
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const r = 5 + Math.random() * 16;
    const v = api.circularOrbitVelocity(coreMass, r) * spin;
    api.addBody({
      name: 'star_' + cx + '_' + i,
      mass: 0.08,
      position: [cx + r * Math.cos(angle), (Math.random() - 0.5) * 1.5, cz + r * Math.sin(angle)],
      velocity: [vx + v * Math.sin(angle), 0, -v * Math.cos(angle)],
      color: color,
      radius: 0.18,
    });
  }
}

makeDisk(-45, -12, 2.6, 3000, 110, '#bfdbfe', 1);
makeDisk(45, 12, -2.6, 3000, 110, '#fed7aa', -1);
`,
  },
  {
    id: "pythagorean",
    name: "Pythagorean Three-Body",
    description: "Masses 3/4/5 at the vertices of a 3-4-5 triangle, released from rest — famously chaotic.",
    source: `// The Burrau / Pythagorean problem: masses 3, 4, 5 at rest on the
// vertices of a 3-4-5 right triangle. It ends in a close triple encounter
// and an ejection — a classic chaotic benchmark.
api.setG(1);
api.setTimeStep(0.0004);
api.setSoftening(0.001);

api.addBody({ name: 'm3', mass: 3, position: [1, 0, 3],  velocity: [0, 0, 0], color: '#f87171', radius: 0.28 });
api.addBody({ name: 'm4', mass: 4, position: [-2, 0, -1], velocity: [0, 0, 0], color: '#60a5fa', radius: 0.32 });
api.addBody({ name: 'm5', mass: 5, position: [1, 0, -1],  velocity: [0, 0, 0], color: '#4ade80', radius: 0.36 });
`,
  },
  {
    id: "broucke",
    name: "Broucke-Hadjidemetriou Orbit",
    description: "A known periodic three-body solution (Broucke A2), equal masses on a closed path.",
    source: `// Broucke A2: an equal-mass periodic three-body solution. Momentum sums
// to zero, so the configuration retraces itself instead of drifting.
// Needs a small timestep — periodic orbits are delicate.
api.setG(1);
api.setTimeStep(0.0002);
api.setSoftening(0.0005);

// Broucke A2 initial conditions (positions on the x axis, velocities along z).
const x1 = 0.3361300950, x2 = 0.7699893804, x3 = -1.1061194753;
const v1 = 1.5324315370, v2 = -0.6287350978, v3 = -0.9036964391;

api.addBody({ name: 'A', mass: 1, position: [x1, 0, 0], velocity: [0, 0, v1], color: '#34d399', radius: 0.06 });
api.addBody({ name: 'B', mass: 1, position: [x2, 0, 0], velocity: [0, 0, v2], color: '#a78bfa', radius: 0.06 });
api.addBody({ name: 'C', mass: 1, position: [x3, 0, 0], velocity: [0, 0, v3], color: '#fb7185', radius: 0.06 });
`,
  },
];
