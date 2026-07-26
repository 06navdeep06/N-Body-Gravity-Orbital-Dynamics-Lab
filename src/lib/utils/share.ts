/**
 * Shareable-URL encoding of a SystemState:
 * JSON → pako deflate → base64url, carried in a `?state=` query param.
 *
 * URLs are practically capped around ~2000 chars; larger states (many
 * bodies) won't fit, so `encodeStateToURL` reports that and callers fall
 * back to a JSON download instead.
 */

import { deflate, inflate } from "pako";
import type { SystemState } from "@/lib/physics/types";

export const URL_LENGTH_LIMIT = 2000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(encoded: string): Uint8Array {
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeState(state: SystemState): string {
  const compressed = deflate(JSON.stringify(state));
  return bytesToBase64Url(compressed);
}

export function decodeState(encoded: string): SystemState | null {
  try {
    const json = inflate(base64UrlToBytes(encoded), { toText: true });
    const parsed = JSON.parse(json) as SystemState;
    if (!Array.isArray(parsed.bodies) || typeof parsed.G !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export type ShareResult =
  | { ok: true; url: string }
  | { ok: false; reason: "too-large"; encodedLength: number };

/** Builds a shareable URL for the state, or reports it's too large to fit. */
export function encodeStateToURL(state: SystemState): ShareResult {
  const encoded = encodeState(state);
  const url = `${window.location.origin}${window.location.pathname}?state=${encoded}`;
  if (url.length > URL_LENGTH_LIMIT) {
    return { ok: false, reason: "too-large", encodedLength: url.length };
  }
  return { ok: true, url };
}

/** Reads and decodes a `?state=` param from the current URL, if present. */
export function readStateFromURL(): SystemState | null {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get("state");
  if (!encoded) return null;
  return decodeState(encoded);
}
