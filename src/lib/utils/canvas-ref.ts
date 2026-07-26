/**
 * Holds a reference to the R3F WebGL canvas so DOM-side code (screenshot,
 * video recording) can reach it. Set once in Scene's onCreated.
 */

let glCanvas: HTMLCanvasElement | null = null;

export function setGlCanvas(canvas: HTMLCanvasElement | null): void {
  glCanvas = canvas;
}

export function getGlCanvas(): HTMLCanvasElement | null {
  return glCanvas;
}
