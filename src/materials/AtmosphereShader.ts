/**
 * Rayleigh + Mie atmospheric scattering shell.
 *
 * This is an analytic approximation, not a raymarched integral through an
 * exponential density profile — it evaluates a single scattering term per
 * fragment on a shell mesh at `radius * ATMOSPHERE_RADIUS_SCALE`, which is
 * what makes it cheap enough to put on a dozen planets at once. Two terms
 * multiply together:
 *
 *   Fresnel rim      F = (1 - V·N)^p
 *     Grazing view rays travel through far more atmosphere than rays looking
 *     straight down, so the limb is bright and the disc centre is clear.
 *
 *   Terminator gate  D = max(0, N·L)
 *     Air only glows where sunlight reaches it. Without this term the halo
 *     rings the whole planet including the night side, which is the single
 *     most common tell of a fake atmosphere.
 *
 * Rayleigh scattering goes as lambda^-4, so its colour is a per-planet
 * constant (blue for N2/O2, rust for a Martian dust haze) rather than
 * something recomputed per fragment. Mie scattering is aerosol scattering
 * off much larger particles: nearly achromatic and strongly forward-biased,
 * so it shows up as a white flare where the view direction lines up with the
 * light — the bloom you see hugging the limb next to the sub-solar point.
 */

import * as THREE from "three";

/** Shell radius as a multiple of the body's surface radius. */
export const ATMOSPHERE_RADIUS_SCALE = 1.035;

/** Cloud shell radius as a multiple of the body's surface radius. */
export const CLOUD_RADIUS_SCALE = 1.015;

const vertexShader = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vViewDirection;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    // The shell is always uniformly scaled, so the model matrix's upper 3x3
    // needs no inverse-transpose to carry the normal correctly.
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDirection = normalize(cameraPosition - worldPosition.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uRayleighColor;
  uniform vec3 uMieColor;
  uniform vec3 uLightDirection;   // normalized, world space, surface -> light
  uniform float uFresnelPower;    // p in (1 - V.N)^p
  uniform float uThickness;       // optical thickness multiplier
  uniform float uIntensity;
  uniform float uMieStrength;
  uniform float uTerminatorSoftness;

  varying vec3 vWorldNormal;
  varying vec3 vViewDirection;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(vViewDirection);
    vec3 L = normalize(uLightDirection);

    // Fresnel rim. clamp() before pow() matters: dot() can drift a hair past
    // 1.0 after interpolation, and pow() of a negative base is undefined.
    float facing = clamp(dot(V, N), 0.0, 1.0);
    float fresnel = pow(1.0 - facing, uFresnelPower);

    // Terminator. smoothstep rather than a hard max() so the day/night
    // boundary fades over a few degrees the way a real one does, instead of
    // cutting off at a visible seam.
    float dayness = max(0.0, dot(N, L));
    float lit = smoothstep(0.0, uTerminatorSoftness, dayness);

    // Mie (aerosol) term. A true Henyey-Greenstein lobe peaks along the
    // forward direction V ~ -L, but that is a backlit planet, where the
    // terminator gate is zero — single scattering off a shell cannot make an
    // eclipse crescent, and a term that never fires is not worth its cost.
    // The part that does survive is Mie's near-achromatic scattering off the
    // most strongly illuminated air, so the lobe keys off local sun
    // elevation: the halo whitens toward the sub-solar limb and stays
    // Rayleigh-blue as it approaches the terminator.
    float mie = pow(dayness, 6.0) * uMieStrength;

    vec3 scattering = uRayleighColor * fresnel + uMieColor * mie * fresnel;
    scattering *= lit * uIntensity * uThickness;

    float alpha = clamp(fresnel * uThickness * lit, 0.0, 1.0);
    if (alpha < 0.003) discard;

    gl_FragColor = vec4(scattering, alpha);
  }
`;

export interface AtmosphereOptions {
  rayleighColor?: THREE.ColorRepresentation;
  mieColor?: THREE.ColorRepresentation;
  /** Optical thickness — Venus is thick, Mars is thin. */
  thickness?: number;
  /** Fresnel exponent; higher pulls the halo tighter to the limb. */
  fresnelPower?: number;
  intensity?: number;
  mieStrength?: number;
  /** Width of the day/night fade, in units of N·L. */
  terminatorSoftness?: number;
}

/**
 * Additively blended, depth-write-disabled shell material.
 *
 * Front faces only: on the near hemisphere the geometric normal turns away
 * from the camera exactly at the silhouette, which is where the Fresnel term
 * peaks — so the halo lands on the limb for free. Rendering back faces
 * instead would give a uniformly bright far hemisphere with no falloff.
 */
export class AtmosphereMaterial extends THREE.ShaderMaterial {
  constructor(options: AtmosphereOptions = {}) {
    super({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uRayleighColor: { value: new THREE.Color(options.rayleighColor ?? "#3d7bff") },
        uMieColor: { value: new THREE.Color(options.mieColor ?? "#bcd8ff") },
        uLightDirection: { value: new THREE.Vector3(0, 0, 1) },
        uFresnelPower: { value: options.fresnelPower ?? 2.6 },
        uThickness: { value: options.thickness ?? 1 },
        uIntensity: { value: options.intensity ?? 1.35 },
        uMieStrength: { value: options.mieStrength ?? 1.6 },
        uTerminatorSoftness: { value: options.terminatorSoftness ?? 0.35 },
      },
    });
  }

  /** Points the terminator at the current primary light. Called per frame. */
  setLightDirection(direction: THREE.Vector3): void {
    (this.uniforms.uLightDirection!.value as THREE.Vector3).copy(direction);
  }

  setRayleighColor(color: THREE.ColorRepresentation): void {
    (this.uniforms.uRayleighColor!.value as THREE.Color).set(color);
  }

  setMieColor(color: THREE.ColorRepresentation): void {
    (this.uniforms.uMieColor!.value as THREE.Color).set(color);
  }

  setThickness(thickness: number): void {
    this.uniforms.uThickness!.value = thickness;
  }

  setFresnelPower(power: number): void {
    this.uniforms.uFresnelPower!.value = power;
  }

  setIntensity(intensity: number): void {
    this.uniforms.uIntensity!.value = intensity;
  }
}

/** Convenience factory matching the rest of the material modules' style. */
export function createAtmosphereMaterial(options?: AtmosphereOptions): AtmosphereMaterial {
  return new AtmosphereMaterial(options);
}
