/**
 * Playwright comparison script:
 * Captures screenshots of our site + Wikipedia, then prints a diff checklist.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUR_URL   = 'https://junehwi07.github.io/wakapada/';
const WIKI_URL  = 'https://en.wikipedia.org/wiki/Folding_table';
const OUT_DIR   = path.join(__dirname, 'compare-shots');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile',  width: 390,  height: 844, isMobile: true },
];

async function shoot(page, url, label) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const outFull = path.join(OUT_DIR, `${label}-full.png`);
  await page.screenshot({ path: outFull, fullPage: true });

  // Header region
  const outHeader = path.join(OUT_DIR, `${label}-header.png`);
  await page.screenshot({ path: outHeader, clip: { x: 0, y: 0, width: page.viewportSize().width, height: 260 } });

  console.log(`  saved: ${outFull}`);
  return outFull;
}

async function extractMetrics(page) {
  return await page.evaluate(() => {
    const header  = document.querySelector('.site-header, #mw-page-container');
    const h1      = document.querySelector('h1');
    const tabBar  = document.querySelector('.tab-bar, #p-views');
    const toc     = document.querySelector('.toc, #toc, .sidebar-toc-inner');
    const content = document.querySelector('.content, #mw-content-text');
    const infobox = document.querySelector('.infobox, table.infobox');
    const footer  = document.querySelector('.footer-note, #footer');
    const sideLeft  = document.querySelector('.wiki-sidebar-left, #vector-toc-pinned-container');
    const sideRight = document.querySelector('.wiki-sidebar-right, .vector-settings-panel');

    function dims(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
               bg: s.backgroundColor, color: s.color, fontSize: s.fontSize, fontFamily: s.fontFamily };
    }

    return {
      h1Text:         h1 ? h1.innerText.trim() : null,
      h1Style:        dims(h1),
      tabBarStyle:    dims(tabBar),
      tocStyle:       dims(toc),
      contentStyle:   dims(content),
      infoboxStyle:   dims(infobox),
      footerStyle:    dims(footer),
      sideLeftStyle:  dims(sideLeft),
      sideRightStyle: dims(sideRight),
      bodyBg:         window.getComputedStyle(document.body).backgroundColor,
      viewportW:      window.innerWidth,
    };
  });
}

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  const issues = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.name} (${vp.width}×${vp.height}) ===`);
    const ctxOpts = { viewport: { width: vp.width, height: vp.height } };
    if (vp.isMobile) {
      ctxOpts.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15';
      ctxOpts.isMobile = true;
    }

    const ctx = await browser.newContext(ctxOpts);

    const pageOurs  = await ctx.newPage();
    const pageWiki  = await ctx.newPage();

    console.log('Shooting our site...');
    await shoot(pageOurs, OUR_URL, `ours-${vp.name}`);
    const metricsOurs = await extractMetrics(pageOurs);

    console.log('Shooting Wikipedia...');
    await shoot(pageWiki, WIKI_URL, `wiki-${vp.name}`);
    const metricsWiki = await extractMetrics(pageWiki);

    // ── Compare ──────────────────────────────────────────────
    const compare = (label, o, w, key, tolerance) => {
      if (!o || !w) { issues.push(`[${vp.name}] ${label}: one side missing`); return; }
      const ov = o[key], wv = w[key];
      if (typeof ov === 'number') {
        if (Math.abs(ov - wv) > tolerance) issues.push(`[${vp.name}] ${label}.${key}: ours=${ov} wiki=${wv} (diff=${Math.abs(ov-wv)})`);
      } else if (ov !== wv) {
        issues.push(`[${vp.name}] ${label}.${key}: ours="${ov}" wiki="${wv}"`);
      }
    };

    // Body background
    if (metricsOurs.bodyBg !== metricsWiki.bodyBg) {
      issues.push(`[${vp.name}] body bg: ours="${metricsOurs.bodyBg}" wiki="${metricsWiki.bodyBg}"`);
    }

    // H1 font size
    compare('h1', metricsOurs.h1Style, metricsWiki.h1Style, 'fontSize', 2);

    // Infobox present?
    if (!metricsOurs.infoboxStyle && metricsWiki.infoboxStyle) issues.push(`[${vp.name}] infobox: missing on our side`);

    // Left TOC sidebar visible on desktop?
    if (vp.name === 'desktop') {
      if (!metricsOurs.sideLeftStyle && metricsWiki.sideLeftStyle)
        issues.push(`[${vp.name}] left TOC sidebar: not found`);
      if (metricsOurs.sideLeftStyle && metricsWiki.sideLeftStyle) {
        compare('sideLeft', metricsOurs.sideLeftStyle, metricsWiki.sideLeftStyle, 'w', 40);
      }
    }

    // Tab bar visible?
    if (!metricsOurs.tabBarStyle) issues.push(`[${vp.name}] tab bar: not found`);

    // Footer visible?
    if (!metricsOurs.footerStyle) issues.push(`[${vp.name}] footer: not found`);
    if (metricsOurs.footerStyle) {
      // footer bg should be white (#ffffff or rgb(255,255,255))
      const bg = metricsOurs.footerStyle.bg;
      const isWhite = bg === 'rgb(255, 255, 255)' || bg === 'rgba(255, 255, 255, 1)';
      if (!isWhite) issues.push(`[${vp.name}] footer bg not white: "${bg}"`);
    }

    // Print raw metrics for manual review
    fs.writeFileSync(
      path.join(OUT_DIR, `metrics-${vp.name}.json`),
      JSON.stringify({ ours: metricsOurs, wiki: metricsWiki }, null, 2)
    );
    await ctx.close();
  }

  await browser.close();

  console.log('\n\n========== DIFF REPORT ==========');
  if (issues.length === 0) {
    console.log('No major issues found!');
  } else {
    issues.forEach((i, n) => console.log(`${n+1}. ${i}`));
  }

  // Save report
  fs.writeFileSync(path.join(OUT_DIR, 'report.txt'), issues.join('\n'));
})();
