/**
 * Core data structures for the N-Body Orbital Dynamics Lab physics engine.
 * All physical quantities are expressed in a self-consistent simulation unit
 * system (the caller decides whether that maps to SI, AU/solar-mass/day, etc.)
 * via the `G` (gravitational constant) and `softening` fields on SystemState.
 */

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface CelestialBody {
  /** Stable unique identifier, independent of array position. */
  id: string;
  name: string;
  /** Mass in simulation mass units. Must be > 0. */
  mass: number;
  position: Vector3D;
  velocity: Vector3D;
  /** CSS/hex color used for rendering. */
  color: string;
  /** Visual/collision radius in simulation length units. */
  radius: number;
  /**
   * When true, the body is treated as immovable (infinite inertia) —
   * useful for anchoring a central sun or black hole. It still exerts
   * gravity on other bodies but never accumulates velocity/position updates.
   */
  isFixed?: boolean;
  /**
   * Renders with the black-hole treatment (event horizon, photon sphere,
   * accretion disk, lensing) instead of a lit sphere. Purely a rendering
   * flag — the physics is the same Newtonian/post-Newtonian gravity.
   */
  isBlackHole?: boolean;
  /**
   * Debris from a tidal disruption. Fragments are rendered as stretched
   * stream particles and are exempt from further disruption (otherwise
   * shredding would cascade without bound).
   */
  isFragment?: boolean;
}

export interface SystemState {
  bodies: CelestialBody[];
  /** Integration time step, in simulation time units. */
  timeStep: number;
  /** Gravitational constant, in simulation units. */
  G: number;
  /** Plummer softening length (epsilon), prevents singularities at r -> 0. */
  softening: number;
}

export interface EnergyMetrics {
  kineticEnergy: number;
  potentialEnergy: number;
  totalEnergy: number;
  angularMomentum: Vector3D;
}
