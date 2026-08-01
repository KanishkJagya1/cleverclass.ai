/**
 * Responsive audit. Loads every key route at several viewport widths in a real
 * headless Chromium and reports measurable failures — not opinions.
 *
 *   node scripts/audit-responsive.mjs [baseUrl]
 *
 * Checks per page/viewport:
 *   1. Horizontal overflow — scrollWidth > clientWidth, AND the specific
 *      elements sticking out. `body { overflow-x: clip }` hides the scrollbar,
 *      so overflow shows up as silently clipped content; this finds it anyway.
 *   2. Touch targets below 44x44 (WCAG 2.5.5) that are actually visible.
 *   3. Text smaller than 12px, which is unreadable on a phone.
 *   4. Fixed/sticky chrome overlapping other fixed/sticky chrome.
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";

const VIEWPORTS = [
  { name: "360 android", width: 360, height: 780 },
  { name: "390 iphone", width: 390, height: 844 },
  { name: "768 tablet", width: 768, height: 1024 },
  { name: "1280 laptop", width: 1280, height: 800 },
];

const ROUTES = [
  "/",
  "/shop",
  "/shop?class=10&medium=marathi",
  "/class",
  "/class/10",
  "/combo-packs",
  "/key-notes",
  "/key-notes/10",
  "/about",
  "/contact",
  "/cart",
  "/checkout",
  "/account",
  "/faqs",
  "/login",
];

const audit = () => {
  const docEl = document.documentElement;
  const limit = docEl.clientWidth;

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };

  // An element inside a clipping ancestor cannot widen the document, so
  // reporting it is noise — it was drowning out the element that actually
  // causes the horizontal scroll.
  const isClipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/hidden|clip|auto|scroll/.test(s.overflowX)) return true;
    }
    return false;
  };

  // --- 1. horizontal overflow ---------------------------------------------
  const overflowing = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    // Ignore anything inside a deliberate horizontal scroller or clip.
    if (el.closest(".rail, [data-scroll-x]")) continue;
    if (isClipped(el)) continue;
    if (r.right > limit + 1 || r.left < -1) {
      overflowing.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className?.baseVal ?? el.className ?? "").toString().slice(0, 70),
        left: Math.round(r.left),
        right: Math.round(r.right),
        over: Math.round(Math.max(r.right - limit, -r.left)),
      });
    }
  }
  // Only report the outermost offenders — a wide parent reports every child.
  const roots = overflowing.filter(
    (o, _i, arr) => !arr.some((p) => p !== o && p.left <= o.left && p.right >= o.right && p.over >= o.over),
  );

  // --- 2. touch targets ----------------------------------------------------
  const small = [];
  if (window.innerWidth < 1024) {
    for (const el of document.querySelectorAll('a, button, [role="button"], input, select')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.top > window.innerHeight * 3) continue; // only what's near the fold
      if (r.width < 44 || r.height < 44) {
        small.push({
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 34),
          size: `${Math.round(r.width)}x${Math.round(r.height)}`,
        });
      }
    }
  }

  // --- 3. tiny text --------------------------------------------------------
  const tiny = [];
  if (window.innerWidth < 1024) {
    for (const el of document.querySelectorAll("p, span, li, td, label, a, button, div")) {
      if (!el.childNodes.length) continue;
      const hasText = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 2,
      );
      if (!hasText || !visible(el)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs > 0 && fs < 12) {
        tiny.push({ px: Math.round(fs * 10) / 10, text: el.textContent.trim().slice(0, 34) });
      }
    }
  }

  // --- 4. fixed/sticky chrome collisions -----------------------------------
  const fixed = [];
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    if (s.position !== "fixed" && s.position !== "sticky") continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    fixed.push({
      el,
      r,
      z: Number(s.zIndex) || 0,
      id: el.id || (el.getAttribute("aria-label") ?? el.tagName.toLowerCase()),
    });
  }
  const collisions = [];
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      const a = fixed[i], b = fixed[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox > 12 && oy > 12) {
        collisions.push({ a: a.id, b: b.id, area: `${Math.round(ox)}x${Math.round(oy)}` });
      }
    }
  }

  return {
    scrollWidth: docEl.scrollWidth,
    clientWidth: limit,
    overflow: roots.slice(0, 6),
    smallTargets: small.slice(0, 6),
    tinyText: tiny.slice(0, 4),
    collisions: collisions.slice(0, 4),
  };
};

const browser = await chromium.launch();
let failures = 0;

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: vp.width < 1024,
    hasTouch: vp.width < 1024,
  });
  const page = await ctx.newPage();

  console.log(`\n══ ${vp.name} (${vp.width}px) ${"═".repeat(Math.max(0, 44 - vp.name.length))}`);

  for (const route of ROUTES) {
    try {
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45000 });
      // Let scroll-reveal and font swap settle before measuring.
      await page.evaluate(() => window.scrollTo(0, 400));
      await page.waitForTimeout(450);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);

      const r = await page.evaluate(audit);
      const issues = [];

      if (r.scrollWidth > r.clientWidth + 1)
        issues.push(`H-SCROLL ${r.scrollWidth}>${r.clientWidth}`);
      if (r.overflow.length) issues.push(`overflow x${r.overflow.length}`);
      if (r.smallTargets.length) issues.push(`small-tap x${r.smallTargets.length}`);
      if (r.tinyText.length) issues.push(`tiny-text x${r.tinyText.length}`);
      if (r.collisions.length) issues.push(`overlap x${r.collisions.length}`);

      if (issues.length) {
        failures++;
        console.log(`  ✗ ${route.padEnd(30)} ${issues.join(" · ")}`);
        r.overflow.forEach((o) => console.log(`      overflow +${o.over}px  <${o.tag}> ${o.cls}`));
        r.smallTargets.forEach((t) => console.log(`      tap ${t.size}  ${t.tag} "${t.label}"`));
        r.tinyText.forEach((t) => console.log(`      text ${t.px}px  "${t.text}"`));
        r.collisions.forEach((c) => console.log(`      overlap ${c.area}  ${c.a} ↔ ${c.b}`));
      } else {
        console.log(`  ✓ ${route}`);
      }
    } catch (err) {
      failures++;
      console.log(`  ! ${route.padEnd(30)} ${err.message.split("\n")[0]}`);
    }
  }
  await ctx.close();
}

await browser.close();
console.log(`\n${failures === 0 ? "PASS — no issues found" : `${failures} page/viewport combinations with issues`}\n`);
process.exit(0);
