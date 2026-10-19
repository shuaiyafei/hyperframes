/**
 * Tells the page's capture motion blur (`data-motion-blur="on"`) to stand down, before any of
 * its scripts run: when the engine blurs (it would average frames that are already blurred) or
 * when the render must match a Studio preview that could not blur (`pageMotionBlur: "off"`).
 */

import { PAGE_MOTION_BLUR_OFF_GLOBAL } from "@hyperframes/core";
import type { Page } from "puppeteer-core";
import type { CaptureOptions } from "../types.js";

export async function installPageMotionBlur(
  page: Pick<Page, "evaluateOnNewDocument">,
  options: Pick<CaptureOptions, "motionBlur" | "pageMotionBlur">,
): Promise<void> {
  const off = options.motionBlur
    ? "engine-motion-blur"
    : options.pageMotionBlur === "off"
      ? "preview-unsupported"
      : null;
  if (!off) return;
  await page.evaluateOnNewDocument(
    (key: string, v: string) => {
      (window as unknown as Record<string, unknown>)[key] = v;
    },
    PAGE_MOTION_BLUR_OFF_GLOBAL,
    off,
  );
}
