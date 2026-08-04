/**
 * Verify the scroll-driven motion system behaves under every gate.
 *
 *   node scripts/audit-motion.mjs [base]
 *
 * The whole design rests on one contract: elements are styled in their FINAL
 * state and the animation is an enhancement. If that inverts — an `opacity: 0`
 * base with no animation to bring it back — the page goes blank for anyone with
 * reduced motion, an old browser, or a low-end device. That is the failure this
 * checks for, at each gate, plus the CLS/LCP rules parallax has to respect.
 */
import { chromium } from "playwright";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const failures = [];

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(label);
}

/** Every animated element must be visible and un-displaced. */
const readState = () =>
  document.evaluate === undefined
    ? null
    : (() => {
        const out = { hidden: [], displaced: [], counts: {} };
        const sel = "[data-reveal], [data-parallax], [data-stack] > *";
        const els = [...document.querySelectorAll(sel)];
        out.counts.animated = els.length;
        out.counts.reveal = document.querySelectorAll("[data-reveal]").length;
        out.counts.parallax = document.querySelectorAll("[data-parallax]").length;
        for (const el of els) {
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;

          // Only elements CURRENTLY IN THE VIEWPORT may be judged on
          // visibility. An element below the fold sitting at opacity 0 is a
          // reveal waiting its turn — that is the feature, not a bug. The
          // failure this is looking for is content visible on screen that the
          // user cannot see.
          const inViewport = r.bottom > 0 && r.top < window.innerHeight;
          if (inViewport && parseFloat(s.opacity) < 0.05) {
            out.hidden.push((el.textContent || el.className || "?").trim().slice(0, 40));
          }
          const t = s.translate;
          if (t && t !== "none") {
            const y = parseFloat(t.split(/\s+/)[1] ?? "0");
            if (Math.abs(y) > 0.5) {
              out.displaced.push(`${(el.className || "?").slice(0, 30)} translateY=${y}`);
            }
          }
        }
        return out;
      })();

async function scenario(browser, name, contextOpts, prep) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...contextOpts,
  });
  const page = await ctx.newPage();
  if (prep) await prep(page);
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForTimeout(900);
  const state = await page.evaluate(readState);
  await ctx.close();
  return { name, state };
}

const browser = await chromium.launch();

console.log(`Motion audit against ${BASE}\n`);

// --- 1. baseline: the system is actually wired up -------------------------
const base = await scenario(browser, "default", {});
console.log(
  `      found ${base.state.counts.reveal} [data-reveal] and ` +
    `${base.state.counts.parallax} [data-parallax] elements`,
);
check("motion attributes are present", base.state.counts.animated > 0,
  "no [data-reveal]/[data-parallax] found — the CSS system is not wired in");
check("nothing is invisible at rest (default)", base.state.hidden.length === 0,
  base.state.hidden.slice(0, 3).join("; "));

// --- 2. reduced motion ----------------------------------------------------
const reduced = await scenario(browser, "reduced-motion", { reducedMotion: "reduce" });
check("nothing is invisible with prefers-reduced-motion", reduced.state.hidden.length === 0,
  reduced.state.hidden.slice(0, 3).join("; "));
check("nothing is displaced with prefers-reduced-motion", reduced.state.displaced.length === 0,
  reduced.state.displaced.slice(0, 3).join("; "));

// --- 3. the low-capability device gate ------------------------------------
const lowPerf = await scenario(browser, "data-perf=low", {}, async (page) => {
  await page.addInitScript(() => {
    // Force the probe in providers/index.tsx down the low path.
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 2 });
    Object.defineProperty(navigator, "deviceMemory", { get: () => 0.5 });
  });
});
check("nothing is invisible on a low-capability device", lowPerf.state.hidden.length === 0,
  lowPerf.state.hidden.slice(0, 3).join("; "));

// --- 4. the progressive-enhancement floor --------------------------------
//
// A browser without scroll-driven animations skips the whole
// `@supports (animation-timeline: view())` block, so animated elements fall
// back to their UNANIMATED styles. This asserts those styles leave content
// visible — i.e. that no `opacity: 0` base state was ever introduced outside
// the @supports guard. (Patching CSS.supports in JS would prove nothing:
// @supports is resolved by the CSS parser, not that API.)
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForTimeout(600);

  const bad = await page.evaluate(() => {
    const offenders = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin
      }
      const walk = (list, guarded) => {
        for (const rule of list) {
          if (rule.conditionText?.includes("animation-timeline")) {
            walk(rule.cssRules ?? [], true);
            continue;
          }
          if (rule.cssRules) {
            walk(rule.cssRules, guarded);
            continue;
          }
          if (guarded) continue;
          const sel = rule.selectorText ?? "";
          if (!/\[data-(reveal|parallax|stack)\]/.test(sel)) continue;
          const op = rule.style?.opacity;
          if (op !== undefined && op !== "" && parseFloat(op) < 0.05) {
            offenders.push(`${sel} { opacity: ${op} }`);
          }
        }
      };
      walk(rules, false);
    }
    return offenders;
  });

  check("no opacity:0 base state outside the @supports guard", bad.length === 0,
    bad.slice(0, 3).join("; ") + " — these hide content in browsers without scroll timelines");
  await ctx.close();
}

// --- 5. the LCP must not sit inside a parallax layer ----------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForTimeout(900);

  const lcp = await page.evaluate(() => {
    const priority = document.querySelector('img[fetchpriority="high"], img[loading="eager"]');
    const h1 = document.querySelector("h1");
    const inParallax = (el) => {
      for (let p = el; p; p = p.parentElement) if (p.hasAttribute?.("data-parallax")) return true;
      return false;
    };
    return {
      imgFound: Boolean(priority),
      imgInParallax: priority ? inParallax(priority) : false,
      h1Found: Boolean(h1),
      h1InParallax: h1 ? inParallax(h1) : false,
    };
  });

  check("the priority image is NOT inside a parallax layer", !lcp.imgInParallax,
    "the LCP element moves on scroll — this is exactly what loses the metric");
  check("the <h1> is NOT inside a parallax layer", !lcp.h1InParallax);
  await ctx.close();
}

// --- 6. parallax layers must not extend the document ---------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  const before = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
  }));
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
  }));
  check("scrolling does not widen the document", after.w <= before.w,
    `${before.w} -> ${after.w}`);
  check("scrolling does not grow the document height", after.h <= before.h + 2,
    `${before.h} -> ${after.h} (a parallax layer is pushing layout)`);
  await ctx.close();
}

await browser.close();

console.log();
if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s): ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("PASS — motion degrades safely at every gate and respects the LCP/CLS rules.");
}
