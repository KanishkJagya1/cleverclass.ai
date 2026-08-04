/**
 * Crawl the running site and fail on anything broken.
 *
 *   node scripts/audit-links.mjs [--base http://localhost:3000]
 *
 * Checks three things that were all genuinely broken before the catalogue
 * migration, and which no type-check or build can catch:
 *
 *   1. Failed network requests — above all images. The seed generated cover and
 *      preview paths for files that had never been downloaded, so most of the
 *      shop grid, two of three gallery thumbnails and every "read free pages"
 *      modal resolved to 404s.
 *   2. Internal links pointing at routes that do not exist (/resources/*, an
 *      advertised /search that was never built).
 *   3. Console errors and unhandled page exceptions.
 */
import { chromium } from "playwright";

const baseArg = process.argv.indexOf("--base");
const BASE = (baseArg > -1 ? process.argv[baseArg + 1] : "http://localhost:3000").replace(/\/$/, "");

/** Representative of every template, not every URL. */
const ROUTES = [
  "/",
  "/shop",
  "/shop?class=10&medium=marathi",
  "/combo-packs",
  "/combo-packs?stream=science-pcm",
  "/class",
  "/class/10",
  "/series/kohinoor",
  "/key-notes",
  "/key-notes?subject=Science",
  "/key-notes/10",
  "/cart",
  "/checkout",
  "/about",
  "/contact",
  "/faqs",
  "/account",
  "/login",
  "/shipping",
  "/privacy",
];

const failures = [];
const seenLinks = new Set();

function record(kind, route, detail) {
  failures.push({ kind, route, detail });
}

async function resolveDynamicRoutes(page) {
  // Pull one real slug per dynamic template rather than hardcoding, so this
  // keeps working as the catalogue changes.
  const extra = [];
  await page.goto(`${BASE}/shop`, { waitUntil: "domcontentloaded" });
  const bookHref = await page.locator('a[href^="/shop/"]').first().getAttribute("href");
  if (bookHref) extra.push(bookHref);

  await page.goto(`${BASE}/combo-packs`, { waitUntil: "domcontentloaded" });
  const comboHref = await page
    .locator('a[href^="/combo-packs/"]')
    .first()
    .getAttribute("href");
  if (comboHref) extra.push(comboHref);

  return extra;
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const routes = [...ROUTES, ...(await resolveDynamicRoutes(page))];
  console.log(`Auditing ${routes.length} routes at ${BASE}\n`);

  for (const route of routes) {
    const badRequests = [];
    const consoleErrors = [];

    const onResponse = (res) => {
      if (res.status() < 400) return;
      const url = res.url();
      // Analytics/telemetry noise is not our problem; anything same-origin is.
      if (!url.startsWith(BASE)) return;
      badRequests.push(`${res.status()} ${res.request().resourceType()} ${url.replace(BASE, "")}`);
    };
    const onConsole = (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
    };
    const onPageError = (err) => consoleErrors.push(`uncaught: ${String(err).slice(0, 200)}`);

    page.on("response", onResponse);
    page.on("console", onConsole);
    page.on("pageerror", onPageError);

    let status = 0;
    try {
      // "load", not "networkidle": image-heavy pages plus the assistant's
      // long-lived connection mean the network never goes idle for 500ms, so
      // networkidle times out on exactly the pages worth auditing.
      const res = await page.goto(`${BASE}${route}`, {
        waitUntil: "load",
        timeout: 45000,
      });
      status = res?.status() ?? 0;
      // Scroll the full page so lazy images below the fold actually request,
      // then settle. This is what surfaces broken covers in a long grid.
      await page.evaluate(async () => {
        const step = window.innerHeight;
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForLoadState("load");
      await page.waitForTimeout(1200);
    } catch (err) {
      record("navigation", route, String(err).slice(0, 160));
    }

    page.off("response", onResponse);
    page.off("console", onConsole);
    page.off("pageerror", onPageError);

    if (status >= 400) record("status", route, `HTTP ${status}`);
    for (const bad of badRequests) record("request", route, bad);
    for (const err of consoleErrors) record("console", route, err);

    // Collect internal links to verify afterwards.
    const hrefs = await page.locator("a[href^='/']").evaluateAll((els) =>
      els.map((e) => e.getAttribute("href")).filter(Boolean),
    );
    for (const href of hrefs) {
      const clean = href.split("#")[0];
      if (clean && !clean.startsWith("/api/")) seenLinks.add(clean);
    }

    const marker = badRequests.length || consoleErrors.length || status >= 400 ? "FAIL" : "ok  ";
    console.log(
      `${marker} ${route.padEnd(40)} ${status}` +
        (badRequests.length ? `  ${badRequests.length} bad request(s)` : "") +
        (consoleErrors.length ? `  ${consoleErrors.length} console error(s)` : ""),
    );
  }

  // --- dead internal links -------------------------------------------------
  console.log(`\nChecking ${seenLinks.size} distinct internal links…`);
  const deadLinks = [];
  for (const href of seenLinks) {
    try {
      const res = await context.request.get(`${BASE}${href}`, { maxRedirects: 5 });
      if (res.status() >= 400) deadLinks.push(`${res.status()} ${href}`);
    } catch (err) {
      deadLinks.push(`ERR  ${href} — ${String(err).slice(0, 80)}`);
    }
  }
  for (const dead of deadLinks) record("dead-link", "(site-wide)", dead);

  await browser.close();

  // --- report --------------------------------------------------------------
  console.log("\n" + "=".repeat(72));
  if (failures.length === 0) {
    console.log("PASS — no bad requests, no console errors, no dead links.");
    return;
  }

  const byKind = failures.reduce((acc, f) => {
    (acc[f.kind] ??= []).push(f);
    return acc;
  }, {});

  for (const [kind, items] of Object.entries(byKind)) {
    console.log(`\n${kind.toUpperCase()} (${items.length})`);
    for (const item of items.slice(0, 25)) {
      console.log(`  ${item.route.padEnd(34)} ${item.detail}`);
    }
    if (items.length > 25) console.log(`  … and ${items.length - 25} more`);
  }

  console.log(`\nFAIL — ${failures.length} issue(s).`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
