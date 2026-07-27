// Direct-summation N-body gravity + Leapfrog (Kick-Drift-Kick) integration.
//
// Leapfrog is symplectic: unlike RK4 it has no secular energy drift over long
// runs, which is what you want when you're taking millions of cheap steps on
// a GPU rather than a few expensive accurate ones.
//
// The step is split across two dispatches so that exactly ONE force
// evaluation happens per step (velocity-Verlet form, carrying acceleration
// forward in a buffer):
//
//   kick_drift:  v += a_old * dt/2        (half kick)
//                x += v * dt              (full drift)
//   accel_kick:  a_new = accel(x)         (the one force evaluation)
//                v += a_new * dt/2        (half kick), store a_new
//
// This split also removes the read-write hazard structurally, so no
// double-buffering of positions is needed: `kick_drift` only ever reads and
// writes its OWN body's position, and `accel_kick` reads all positions but
// writes only its own velocity/acceleration. See gpu-engine.ts.
//
// Force accumulation is tiled through workgroup-shared memory: each of the
// 256 threads in a workgroup cooperatively loads one body into shared
// storage, then all 256 threads read those 256 bodies from fast shared
// memory instead of hitting global storage N times each.

struct Params {
  dt: f32,
  g: f32,
  softening: f32,
  count: u32,
};

// vec4: xyz = position, w = mass
@group(0) @binding(0) var<storage, read_write> positions_masses: array<vec4<f32>>;
// vec4: xyz = velocity, w = isFixed flag (0 = free, 1 = pinned/immovable)
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
// vec4: xyz = acceleration carried between steps, w unused
@group(0) @binding(2) var<storage, read_write> accelerations: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> params: Params;

const WORKGROUP_SIZE: u32 = 256u;

var<workgroup> tile: array<vec4<f32>, 256>;

// Softened Newtonian acceleration on `self_pos` from a single body.
// a = G * m * d / (|d|^2 + eps^2)^(3/2)
fn pair_accel(self_pos: vec3<f32>, other: vec4<f32>, eps2: f32, g: f32) -> vec3<f32> {
  let d = other.xyz - self_pos;
  let dist_sq = dot(d, d) + eps2;
  // inverse_sqrt(x)^3 == 1 / x^1.5
  let inv_dist3 = inverseSqrt(dist_sq * dist_sq * dist_sq);
  return d * (g * other.w * inv_dist3);
}

// Total acceleration on body `index`, tiled through shared memory.
// Every thread in the workgroup must reach this function (uniform control
// flow) because it contains workgroupBarrier().
fn compute_accel(index: u32, local_index: u32) -> vec3<f32> {
  let n = params.count;
  let eps2 = params.softening * params.softening;
  let g = params.g;

  // Threads past the end of the body list still participate in the tiling
  // loop and its barriers; they just read a harmless dummy position.
  let valid = index < n;
  let self_pos = select(vec3<f32>(0.0, 0.0, 0.0), positions_masses[index].xyz, valid);

  var acc = vec3<f32>(0.0, 0.0, 0.0);
  var tile_start: u32 = 0u;

  loop {
    if (tile_start >= n) { break; }

    // Cooperatively stage one tile of bodies into workgroup memory.
    let load_index = tile_start + local_index;
    if (load_index < n) {
      tile[local_index] = positions_masses[load_index];
    } else {
      // Zero mass contributes no force, so out-of-range lanes are inert.
      tile[local_index] = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }
    workgroupBarrier();

    if (valid) {
      let tile_count = min(WORKGROUP_SIZE, n - tile_start);
      for (var j: u32 = 0u; j < tile_count; j = j + 1u) {
        // Skip self-interaction (would be a divide-by-eps^2 self-kick).
        if (tile_start + j != index) {
          acc = acc + pair_accel(self_pos, tile[j], eps2, g);
        }
      }
    }
    workgroupBarrier();

    tile_start = tile_start + WORKGROUP_SIZE;
  }

  return acc;
}

// One-time bootstrap: fill the acceleration buffer for the initial state so
// the first kick_drift has a valid a_old to work with.
@compute @workgroup_size(256)
fn bootstrap_accel(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_index) local_index: u32,
) {
  let index = gid.x;
  let acc = compute_accel(index, local_index);
  if (index >= params.count) { return; }
  accelerations[index] = vec4<f32>(acc, 0.0);
}

// Half kick + full drift. Reads/writes only this body's own state.
@compute @workgroup_size(256)
fn kick_drift(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.count) { return; }

  let vel = velocities[index];
  // Pinned bodies (central stars, black holes) still exert gravity but never
  // move, matching the CPU engine's `isFixed` semantics.
  if (vel.w > 0.5) { return; }

  let dt = params.dt;
  let half_kicked = vel.xyz + accelerations[index].xyz * (dt * 0.5);

  velocities[index] = vec4<f32>(half_kicked, vel.w);
  let pm = positions_masses[index];
  positions_masses[index] = vec4<f32>(pm.xyz + half_kicked * dt, pm.w);
}

// The single force evaluation, then the closing half kick.
@compute @workgroup_size(256)
fn accel_kick(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_index) local_index: u32,
) {
  let index = gid.x;
  // compute_accel has barriers, so it must run for every lane in the
  // workgroup — the range check happens after it returns.
  let acc = compute_accel(index, local_index);
  if (index >= params.count) { return; }

  accelerations[index] = vec4<f32>(acc, 0.0);

  let vel = velocities[index];
  if (vel.w > 0.5) { return; }
  velocities[index] = vec4<f32>(vel.xyz + acc * (params.dt * 0.5), vel.w);
}
