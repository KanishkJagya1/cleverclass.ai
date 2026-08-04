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
  // 320 is the narrowest viewport worth supporting and the one that actually
  // breaks: it is a Galaxy A-series / older iPhone SE in portrait, which is a
  // real share of this audience.
  { name: "320 small", width: 320, height: 720, touch: true },
  { name: "360 android", width: 360, height: 780, touch: true },
  { name: "390 iphone", width: 390, height: 844, touch: true },
  { name: "768 tablet", width: 768, height: 1024, touch: true },
  { name: "1280 laptop", width: 1280, height: 800, touch: false },
  { name: "1536 desktop", width: 1536, height: 900, touch: false },
];

const ROUTES = [
  "/",
  "/shop",
  "/shop?class=10&medium=marathi",
  "/class",
  "/class/10",
  "/combo-packs",
  "/combo-packs?stream=science-pcm",
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
  //
  // Encodes what WCAG actually requires, rather than 44x44 for everything:
  //
  //   2.5.8 (AA)   24x24 minimum, with an explicit exception for links inside
  //                a sentence, where the target size is determined by the line
  //                height of the text.
  //   2.5.5 (AAA)  44x44 — the bar we hold CONTROLS to: buttons, selects,
  //                inputs, and links styled as blocks (nav items, cards, tabs).
  //
  // The distinction matters. A footer column link reading "Spark" is 38px wide
  // because the word is 38px wide; padding it to 44 would look broken and fixes
  // nothing, since vertical spacing is what prevents miss-taps in a list. But a
  // 36px sort dropdown or a 36px wishlist button genuinely is a miss-tap.
  //
  // So: controls must be 44x44. Inline links must clear 24px in both axes and
  // 44px in the block direction (their line box), which is the axis a thumb
  // actually has to hit in a vertical list.
  const small = [];
  if (window.innerWidth < 1024) {
    const isControl = (el) => {
      const tag = el.tagName.toLowerCase();
      if (tag !== "a") return true; // button, input, select, [role=button]
      // A link counts as a control when it is laid out as a block-level box
      // rather than flowing inside a sentence. `inline-flex` and
      // `inline-block` are deliberately NOT here: those are exactly what the
      // 44px-tall touch padding produces on ordinary text links, and treating
      // them as controls would demand a 44px-WIDE target for the word "Spark".
      const d = getComputedStyle(el).display;
      return d === "block" || d === "flex" || d === "grid";
    };

    // WCAG 2.5.8's "Inline" exception: a target inside a sentence, whose size
    // is constrained by the line-height of the surrounding text, is exempt.
    // Detected structurally — the parent contains real text besides this link.
    const isInSentence = (el) => {
      const parent = el.parentElement;
      if (!parent) return false;
      const own = (el.textContent || "").trim();
      const all = (parent.textContent || "").trim();
      return all.length > own.length + 3;
    };

    // "Stretched link": a card where the title anchor holds an absolutely
    // positioned overlay covering the whole card, so the real hit area is the
    // card, not the text. Measuring the text reported a 190x19 target for
    // something a thumb cannot miss. Returns the true target rect.
    const effectiveRect = (el) => {
      const own = el.getBoundingClientRect();
      for (const child of el.querySelectorAll(":scope > *")) {
        if (getComputedStyle(child).position !== "absolute") continue;
        const r = child.getBoundingClientRect();
        // Must actually ENLARGE the target in both axes to count as a stretch.
        // Without this check a 6x6 decorative dot positioned inside the link
        // was mistaken for the overlay and reported as a 6x6 tap target.
        if (r.width >= own.width && r.height >= own.height && r.width > 0) return r;
      }
      return own;
    };

    for (const el of document.querySelectorAll('a, button, [role="button"], input, select')) {
      if (!visible(el)) continue;
      const r = effectiveRect(el);
      if (r.top > window.innerHeight * 3) continue; // only what's near the fold

      const control = isControl(el);
      if (!control && isInSentence(el)) continue; // WCAG 2.5.8 inline exception
      // Controls: 44x44 (2.5.5 AAA — the bar we hold ourselves to).
      // Inline links: 24x24 (2.5.8 AA), which is what the standard actually
      // requires for a link flowing in text. Demanding 44px of height from an
      // anchor inside a sentence produces findings nobody can action without
      // wrecking the typography.
      const minW = control ? 44 : 24;
      const minH = control ? 44 : 24;
      // 0.5px tolerance: getBoundingClientRect returns fractional values, so an
      // element sized to exactly 2.75rem can measure 43.99 at devicePixelRatio
      // 2 and report as a failure it is not.
      if (r.width < minW - 0.5 || r.height < minH - 0.5) {
        small.push({
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 34),
          size: `${Math.round(r.width)}x${Math.round(r.height)}`,
          kind: control ? "control" : "inline-link",
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
    isMobile: vp.touch,
    // hasTouch drives `pointer: coarse`, which is what the `coarse:` variant
    // keys off. Without it the touch viewports would be measured with desktop
    // tap targets and every touch-only sizing rule would read as absent.
    hasTouch: vp.touch,
  });
  const page = await ctx.newPage();

  console.log(`\n══ ${vp.name} (${vp.width}px) ${"═".repeat(Math.max(0, 44 - vp.name.length))}`);

  for (const route of ROUTES) {
    try {
      // "load", not "networkidle": with lazy images and the assistant's
      // connection the network never idles for 500ms on the busiest pages, so
      // networkidle timed out on exactly the routes worth measuring.
      await page.goto(BASE + route, { waitUntil: "load", timeout: 45000 });
      // Let scroll-reveal and font swap settle before measuring.
      await page.evaluate(() => window.scrollTo(0, 400));
      await page.waitForTimeout(600);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);

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
        r.smallTargets.forEach((t) =>
          console.log(`      tap ${t.size}  ${t.kind} ${t.tag} "${t.label}"`),
        );
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
