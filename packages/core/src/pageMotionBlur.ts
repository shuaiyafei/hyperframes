// Set by the engine: its own sub-frame blur runs, or the Studio preview could not blur.
export const PAGE_MOTION_BLUR_OFF_GLOBAL = "__HF_PAGE_MOTION_BLUR_OFF__";

// Render scale from the engine: devicePixelRatio falls back to 1 after its first screenshot.
export const PAGE_DEVICE_SCALE_GLOBAL = "__HF_DEVICE_SCALE_FACTOR__";

export function supportsCaptureMotionBlur(win: Window = window): boolean {
  const w = win as Window & {
    CanvasRenderingContext2D?: { prototype: object };
    HTMLCanvasElement?: { prototype: object };
  };
  const ctx = w.CanvasRenderingContext2D?.prototype;
  const canvas = w.HTMLCanvasElement?.prototype;
  return !!ctx && !!canvas && "drawElementImage" in ctx && "requestPaint" in canvas;
}
