// Render the same four-square mark used by Brand into Chrome's required PNG sizes.
// Uses the project's Playwright dependency; optional argument: Chromium executable path.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const source = await readFile(resolve('public/icon/logo.svg'), 'utf8');
const browser = await chromium.launch({ executablePath: process.argv[2] || undefined, headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${source}`);
    await page.screenshot({ path: resolve(`public/icon/${size}.png`), omitBackground: true });
  }
} finally { await browser.close(); }
