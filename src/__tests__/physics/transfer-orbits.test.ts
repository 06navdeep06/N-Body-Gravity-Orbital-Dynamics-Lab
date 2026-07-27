/**
 * Transfer orbits: Hohmann and bi-elliptic Δv against closed-form values,
 * and the Lambert solver against the circular-orbit case it must reproduce.
 */

import {
  biEllipticTransfer,
  hohmannTransfer,
  solveLambert,
} from "@/lib/physics/transfer-orbits";
import { length, sub } from "@/lib/physics/vector";

describe("Hohmann transfer", () => {
  const mu = 1000;
  const r1 = 10;
  const r2 = 30;

  it("matches the analytic delta-v formulas", () => {
    const t = hohmannTransfer(mu, r1, r2);
    // Δv₁ = √(μ/r₁)·(√(2r₂/(r₁+r₂)) − 1)
    const expectedDv1 = Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
    // Δv₂ = √(μ/r₂)·(1 − √(2r₁/(r₁+r₂)))
    const expectedDv2 = Math.sqrt(mu / r2) * (1 - Math.sqrt((2 * r1) / (r1 + r2)));

    expect(t.deltaV1).toBeCloseTo(expectedDv1, 10);
    expect(t.deltaV2).toBeCloseTo(expectedDv2, 10);
    expect(t.totalDeltaV).toBeCloseTo(expectedDv1 + expectedDv2, 10);
  });

  it("uses the correct transfer semi-major axis and time", () => {
    const t = hohmannTransfer(mu, r1, r2);
    const at = (r1 + r2) / 2;
    expect(t.semiMajorAxis).toBeCloseTo(at, 12);
    // Half the transfer ellipse's period.
    expect(t.transferTime).toBeCloseTo(Math.PI * Math.sqrt(at ** 3 / mu), 10);
  });

  it("is symmetric in cost between raising and lowering", () => {
    const up = hohmannTransfer(mu, r1, r2);
    const down = hohmannTransfer(mu, r2, r1);
    expect(down.totalDeltaV).toBeCloseTo(up.totalDeltaV, 10);
  });

  it("reproduces the Earth-to-Mars budget in solar units", () => {
    // AU / M☉ / years: mu = 4pi^2, Earth r=1, Mars r=1.524.
    const muSolar = 4 * Math.PI * Math.PI;
    const t = hohmannTransfer(muSolar, 1, 1.524);
    // Published values: ~2.94 km/s and ~2.65 km/s; 1 AU/yr = 4.7405 km/s.
    const AU_PER_YEAR_IN_KM_S = 4.74057;
    expect(t.deltaV1 * AU_PER_YEAR_IN_KM_S).toBeCloseTo(2.94, 1);
    expect(t.deltaV2 * AU_PER_YEAR_IN_KM_S).toBeCloseTo(2.65, 1);
    // Transfer time ~259 days.
    expect(t.transferTime * 365.25).toBeCloseTo(259, 0);
  });
});

describe("bi-elliptic transfer", () => {
  const mu = 1000;

  it("beats Hohmann for large radius ratios", () => {
    // The classical crossover is r2/r1 ≈ 11.94.
    const r1 = 10;
    const r2 = 150; // ratio 15 — bi-elliptic should win
    expect(biEllipticTransfer(mu, r1, r2).totalDeltaV).toBeLessThan(
      hohmannTransfer(mu, r1, r2).totalDeltaV
    );
  });

  it("loses to Hohmann for small radius ratios", () => {
    const r1 = 10;
    const r2 = 20; // ratio 2 — Hohmann should win
    expect(biEllipticTransfer(mu, r1, r2).totalDeltaV).toBeGreaterThan(
      hohmannTransfer(mu, r1, r2).totalDeltaV
    );
  });

  it("takes longer than Hohmann", () => {
    const r1 = 10;
    const r2 = 150;
    expect(biEllipticTransfer(mu, r1, r2).transferTime).toBeGreaterThan(
      hohmannTransfer(mu, r1, r2).transferTime
    );
  });

  it("reports three burns that sum to the total", () => {
    const t = biEllipticTransfer(mu, 10, 150);
    expect(t.deltaV1 + t.deltaV2 + t.deltaV3).toBeCloseTo(t.totalDeltaV, 10);
  });
});

describe("Lambert solver", () => {
  const mu = 1000;
  const r = 20;
  const vCircular = Math.sqrt(mu / r);
  const period = 2 * Math.PI * Math.sqrt(r ** 3 / mu);

  it("recovers circular velocity across a quarter orbit", () => {
    // Prograde here means +X advancing toward -Z.
    const r1 = { x: r, y: 0, z: 0 };
    const r2 = { x: 0, y: 0, z: -r };
    const solution = solveLambert(r1, r2, period / 4, mu, true);

    expect(solution).not.toBeNull();
    expect(length(solution!.v1)).toBeCloseTo(vCircular, 4);
    expect(length(solution!.v2)).toBeCloseTo(vCircular, 4);
    // Departure velocity is tangential: perpendicular to the radius.
    const radial = (solution!.v1.x * r1.x + solution!.v1.z * r1.z) / r;
    expect(Math.abs(radial)).toBeLessThan(1e-3);
  });

  it("returns null for an exactly 180-degree transfer", () => {
    // Antiparallel radius vectors leave the orbital plane undetermined, so
    // infinitely many transfers satisfy the constraints. Refusing to invent
    // one is the correct behavior; hohmannTransfer covers the coplanar case.
    expect(solveLambert({ x: r, y: 0, z: 0 }, { x: -r, y: 0, z: 0 }, period / 2, mu, true)).toBeNull();
  });

  it("solves just short of 180 degrees", () => {
    const angle = Math.PI * 0.99;
    const target = { x: r * Math.cos(angle), y: 0, z: -r * Math.sin(angle) };
    const solution = solveLambert({ x: r, y: 0, z: 0 }, target, period * 0.495, mu, true);
    expect(solution).not.toBeNull();
    expect(length(solution!.v1)).toBeCloseTo(vCircular, 2);
  });

  it("produces a faster departure for a shorter time of flight", () => {
    const r1 = { x: r, y: 0, z: 0 };
    const r2 = { x: 0, y: 0, z: -r };
    const slow = solveLambert(r1, r2, period / 4, mu, true);
    const fast = solveLambert(r1, r2, period / 8, mu, true);
    expect(slow).not.toBeNull();
    expect(fast).not.toBeNull();
    expect(length(fast!.v1)).toBeGreaterThan(length(slow!.v1));
  });

  it("rejects degenerate inputs", () => {
    expect(solveLambert({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 1, mu)).toBeNull();
    expect(solveLambert({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 0, mu)).toBeNull();
    expect(solveLambert({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, -5, mu)).toBeNull();
  });

  it("approaches the Hohmann solution as the transfer angle approaches 180 degrees", () => {
    // The Hohmann ellipse IS the 180° transfer. Lambert can't be evaluated
    // exactly there (see above), but sweeping toward it must converge on the
    // same departure burn.
    const rA = 10;
    const rB = 30;
    const hohmann = hohmannTransfer(mu, rA, rB);
    const circularSpeed = Math.sqrt(mu / rA);

    const errorAt = (fraction: number): number => {
      const angle = Math.PI * fraction;
      const target = { x: rB * Math.cos(angle), y: 0, z: -rB * Math.sin(angle) };
      const solution = solveLambert(
        { x: rA, y: 0, z: 0 },
        target,
        hohmann.transferTime * fraction,
        mu,
        true
      );
      expect(solution).not.toBeNull();
      return Math.abs(length(solution!.v1) - circularSpeed - hohmann.deltaV1);
    };

    expect(errorAt(0.999)).toBeLessThan(errorAt(0.9));
    expect(errorAt(0.999)).toBeLessThan(0.05);
    void sub;
  });
});
