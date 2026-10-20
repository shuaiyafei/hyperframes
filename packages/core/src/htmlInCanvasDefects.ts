import { CAPTURE_CANVAS_SELECTOR } from "./htmlInCanvas";

type UaWindow = { navigator: { userAgent: string } };

/**
 * Major Chrome version from the user agent (HeadlessChrome included), or null when unknown.
 * For reports and log text only: no defect is gated on it.
 */
export function chromeMajor(win: UaWindow = window): number | null {
  const m = /Chrome\/(\d+)/.exec(win.navigator.userAgent);
  return m?.[1] ? Number(m[1]) : null;
}

export interface CaptureDefect {
  code: string;
  reason: string;
}

export interface DefectEnv {
  isAccelerated: (canvas: HTMLCanvasElement) => boolean;
  /** Result of `scanBackfaceDefect`, refreshed whenever the scene is rescanned. */
  backface: boolean;
}

// Every defect blocks on every Chrome version: the render browser, the Docker browser and the
// preview browser can differ, and a render must match what the preview showed. The versions
// noted per entry are documentation only; revisit once the render pin and the support floor
// both pass the last affected major.
interface Defect {
  code: string;
  reason: string;
  detect: (root: HTMLElement, env: DefectEnv) => boolean;
}

const hasHidden3dFace = (_root: HTMLElement, env: DefectEnv): boolean => env.backface;

const hasAcceleratedCanvas = (root: HTMLElement, env: DefectEnv): boolean =>
  Array.from(root.querySelectorAll("canvas")).some(env.isAccelerated);

// GSAP writes an identity matrix when it rewinds a root transform; that changes nothing on screen.
const IDENTITY_TRANSFORM =
  /^matrix\(\s*1,\s*0,\s*0,\s*1,\s*0,\s*0\s*\)$|^matrix3d\(\s*1,\s*0,\s*0,\s*0,\s*0,\s*1,\s*0,\s*0,\s*0,\s*0,\s*1,\s*0,\s*0,\s*0,\s*0,\s*1\s*\)$/;

const hasRootTransform = (root: HTMLElement): boolean => {
  const t = getComputedStyle(root).transform.trim();
  return t !== "none" && t !== "" && !IDENTITY_TRANSFORM.test(t);
};

const hasRootOpacity = (root: HTMLElement): boolean =>
  Number.parseFloat(getComputedStyle(root).opacity) < 1;

const DEFECTS: readonly Defect[] = [
  {
    code: "nested-capture-canvas",
    reason: "the composition already uses html-in-canvas",
    detect: (root) => root.querySelector(CAPTURE_CANVAS_SELECTOR) !== null,
  },
  {
    // Chrome <=156 captures the canvas frozen at its pre-wrap frame; 157 fixed it.
    code: "accelerated-canvas",
    reason: "the composition draws a WebGL/WebGPU canvas, which html-in-canvas captures frozen",
    detect: hasAcceleratedCanvas,
  },
  {
    code: "backface-visibility",
    reason: "backface-visibility: hidden inside a 3D transform is drawn mirrored by html-in-canvas",
    detect: hasHidden3dFace,
  },
  {
    // Ignored by Chrome <=156; fixed in 157.
    code: "root-transform",
    reason: "html-in-canvas can ignore a transform on the composition root",
    detect: hasRootTransform,
  },
  {
    // Ignored by Chrome >=155.
    code: "root-opacity",
    reason: "html-in-canvas can ignore the composition root's own opacity",
    detect: hasRootOpacity,
  },
];

/** The first defect that makes html-in-canvas capture this root wrongly in any supported browser, or null. */
export function findCaptureDefect(root: HTMLElement, env: DefectEnv): CaptureDefect | null {
  const defect = DEFECTS.find((d) => d.detect(root, env));
  return defect ? { code: defect.code, reason: defect.reason } : null;
}

const FACE_3D_TRANSFORM = /perspective\(|rotate3d\(|rotate[XY]\(|matrix3d\(/;

function isHidden(cs: CSSStyleDeclaration): boolean {
  return (
    cs.getPropertyValue("backface-visibility") === "hidden" ||
    cs.getPropertyValue("-webkit-backface-visibility") === "hidden"
  );
}

function transformsIn3d(el: HTMLElement, cs: CSSStyleDeclaration): boolean {
  return FACE_3D_TRANSFORM.test(cs.transform) || FACE_3D_TRANSFORM.test(el.style.transform);
}

function in3dContext(el: HTMLElement, root: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (cs.transformStyle === "preserve-3d" || transformsIn3d(node, cs)) return true;
    if (node !== el && cs.perspective !== "none" && cs.perspective !== "") return true;
    if (node === root) break;
  }
  return false;
}

function* styleRules(rules: CSSRuleList): Generator<CSSStyleRule> {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) yield rule;
    else if ("cssRules" in rule && rule.cssRules instanceof CSSRuleList)
      yield* styleRules(rule.cssRules);
  }
}

function sheetRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
}

function matching(root: HTMLElement, selector: string): HTMLElement[] {
  try {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector));
    return root.matches(selector) ? [root, ...found] : found;
  } catch {
    return [];
  }
}

function hiddenSelectors(): string[] {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    const rules = sheetRules(sheet);
    if (!rules) continue;
    for (const rule of styleRules(rules)) if (isHidden(rule.style)) out.push(rule.selectorText);
  }
  return out;
}

/**
 * Whether a `backface-visibility: hidden` element is in a 3D context (preserve-3d, perspective or
 * a 3D transform) right now; html-in-canvas draws such a face anyway. Flat uses are a harmless
 * performance hack. The stylesheet walk happens once; each call re-matches the selectors and
 * re-reads the 3D context, so call it at several timeline times to see a rotation that only a
 * later tween applies.
 */
function createBackfaceCheck(root: HTMLElement): () => boolean {
  const selectors = hiddenSelectors();
  return () => {
    const candidates = new Set<HTMLElement>(root.querySelectorAll('[style*="backface"]'));
    for (const selector of selectors) for (const el of matching(root, selector)) candidates.add(el);
    for (const el of candidates) {
      if (isHidden(getComputedStyle(el)) && in3dContext(el, root)) return true;
    }
    return false;
  };
}

/** `createBackfaceCheck` evaluated once, at the current time. */
export function scanBackfaceDefect(root: HTMLElement): boolean {
  return createBackfaceCheck(root)();
}

/** The timeline is sampled for the backface check every this many scan steps. */
const FACE_EVERY = 10;

export interface DefectScan {
  /** Evaluate step `i` of `steps`, which sits at timeline time `at` seconds. */
  sample: (i: number, steps: number, at: number) => void;
  /** The first defect any sample saw, its reason saying when; null for a clean timeline. */
  result: () => CaptureDefect | null;
}

/**
 * Decide the defects once per timeline: feed it every step of the mover scan. Root-level and
 * canvas defects are read at every step, the backface check every FACE_EVERY-th and the last.
 */
export function createDefectScan(
  root: HTMLElement,
  isAccelerated: DefectEnv["isAccelerated"],
): DefectScan {
  const faces = createBackfaceCheck(root);
  let found: CaptureDefect | null = null;
  return {
    sample: (i, steps, at) => {
      if (found) return;
      const checkFaces = i % FACE_EVERY === 0 || i === steps;
      const defect = findCaptureDefect(root, { isAccelerated, backface: checkFaces && faces() });
      if (defect)
        found = { ...defect, reason: `${defect.reason} (first seen at t=${at.toFixed(1)}s)` };
    },
    result: () => found,
  };
}
