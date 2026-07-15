import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Browser, Page } from 'playwright';

import type { DevApi } from '../scripts/dev-api.mjs';

/**
 * PHASE 7 ACCEPTANCE, executable — real Chromium against the real
 * playground page and the real fake-pipeline API:
 *
 *   pick element → submit → status updates render; masked inputs never
 *   appear in payload or screenshot (pixel proof).
 *
 * Env-gated: set PATCHBACK_BROWSER_TESTS=1 (and `pnpm exec playwright
 * install chromium` once) to run. Fresh clones stay green and
 * browser-free; CI runs this in a dedicated job.
 */
const ENABLED = process.env.PATCHBACK_BROWSER_TESTS === '1';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VITE_PORT = 5199;
const PAGE_URL = `http://127.0.0.1:${VITE_PORT}/`;

/** The redaction fill (REDACTION_FILL in the widget) as RGB. */
const FILL = { r: 0x24, g: 0x2a, b: 0x33 };
/** Lossy WebP/JPEG headroom per channel. */
const TOLERANCE = 14;

interface CloseableViteServer {
  listen(): Promise<unknown>;
  close(): Promise<void>;
}

describe.skipIf(!ENABLED)('playground browser acceptance', () => {
  let api: DevApi;
  let vite: CloseableViteServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const { createDevApi } = await import('../scripts/dev-api.mjs');
    api = await createDevApi({
      port: 8799,
      triageDelayMs: 300,
      patchDelayMs: 600,
    });

    const { createServer } = await import('vite');
    vite = (await createServer({
      configFile: join(ROOT, 'vite.config.ts'),
      root: ROOT,
      server: {
        host: '127.0.0.1',
        port: VITE_PORT,
        strictPort: true,
        proxy: {
          '/api': {
            target: 'http://127.0.0.1:8799',
            changeOrigin: true,
            rewrite: (path: string) => path.replace(/^\/api/, ''),
          },
        },
      },
    })) as unknown as CloseableViteServer;
    await vite.listen();

    const { chromium } = await import('playwright');
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
    await api?.close();
  });

  async function waitForChipState(
    state: string,
    timeout = 30_000,
  ): Promise<void> {
    await page.waitForSelector(`.pb-chip[data-state="${state}"]`, { timeout });
  }

  it('runs the full loop with payload + screenshot pixel proofs', async () => {
    await page.goto(PAGE_URL);

    // Geometry we will verify against, measured BEFORE capture.
    const pwBox = await page.locator('#acct-password').boundingBox();
    const ignoredBox = await page.locator('.ignored-card').boundingBox();
    expect(pwBox).not.toBeNull();
    expect(ignoredBox).not.toBeNull();

    // Open the widget (launcher lives in the open shadow root; playwright
    // CSS pierces it).
    await page.click('.pb-launcher');
    await page.fill(
      '.pb-panel textarea',
      'Change the export button label from "Expot" to "Export"',
    );

    // --- Element picker: hover-highlight geometry, then pick. ---
    await page.getByRole('button', { name: 'Point at the problem' }).click();
    const target = await page.locator('#export-btn').boundingBox();
    expect(target).not.toBeNull();
    const cx = (target?.x ?? 0) + (target?.width ?? 0) / 2;
    const cy = (target?.y ?? 0) + (target?.height ?? 0) / 2;
    await page.mouse.move(cx, cy);
    // The highlight box must track the hovered element's rect.
    await page.waitForSelector('.pb-picker-box');
    const highlight = await page.locator('.pb-picker-box').boundingBox();
    expect(Math.abs((highlight?.x ?? 0) - (target?.x ?? 0))).toBeLessThan(4);
    expect(
      Math.abs((highlight?.width ?? 0) - (target?.width ?? 0)),
    ).toBeLessThan(6);
    await page.mouse.click(cx, cy);
    await page.waitForSelector('[data-preview="element"]');

    // The ignored card must be unpickable: enter picking, hover it,
    // click — the picker stays active (click is a no-op), Escape leaves.
    await page
      .getByRole('button', { name: 'Pick a different element' })
      .click();
    const icx = (ignoredBox?.x ?? 0) + 20;
    const icy = (ignoredBox?.y ?? 0) + 20;
    await page.mouse.move(icx, icy);
    await page.waitForSelector('.pb-picker-box[data-excluded]');
    await page.mouse.click(icx, icy);
    const stillPicking = await page.$('.pb-picker-overlay');
    expect(stillPicking).not.toBeNull();
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-preview="element"]');

    // --- Console buffer (config-enabled in the playground). ---
    // The demo page's error was thrown before the panel opened? Throw now:
    // the page keeps recording while the panel is open.
    // (The panel re-renders on structural changes; entries are read at
    // render/submit time.)

    // --- Screenshot (gesture consent). ---
    await page.getByRole('button', { name: 'Attach screenshot' }).click();
    await page.waitForSelector('[data-preview="screenshot"] img', {
      timeout: 30_000,
    });

    // --- Submit. ---
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Send feedback' })
      .click();
    await waitForChipState('feedback.triaged');
    await page.waitForSelector('text=Triaged — ready for a patch');

    // --- Payload proof (read the STORED item straight from the store). ---
    expect(api.createdFeedbackIds.length).toBeGreaterThan(0);
    const feedbackId = api.createdFeedbackIds[0] as string;
    const item = await api.store.getFeedback(feedbackId);
    expect(item).toBeDefined();
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain('SENTINEL');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('sentinel-mail@example.com');
    expect(item?.capture?.element?.domPath).toBe('#export-btn');
    expect(item?.capture?.element?.text).toContain('Expot CSV');
    expect(item?.capture?.url).toBe(PAGE_URL);
    expect(item?.trustTier).toBe('insider');

    // --- Screenshot pixel proof: masked regions are UNIFORMLY the
    // redaction fill. ---
    const shot = item?.capture?.screenshot;
    expect(shot?.masked).toBe(true);
    const dataUri = shot?.dataUri ?? '';
    expect(dataUri.startsWith('data:image/')).toBe(true);
    expect(dataUri.length).toBeLessThanOrEqual(524288);

    const regions = [
      { name: 'password', box: pwBox },
      { name: 'ignored-card', box: ignoredBox },
    ].map(({ name, box }) => ({
      name,
      x: (box?.x ?? 0) + 4,
      y: (box?.y ?? 0) + 4,
      width: Math.max((box?.width ?? 0) - 8, 1),
      height: Math.max((box?.height ?? 0) - 8, 1),
    }));

    const sampled = await page.evaluate(
      async ({ uri, regions: regs, viewportWidth, tolerance }) => {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('screenshot decode failed'));
          img.src = uri;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx === null) {
          throw new Error('no 2d context');
        }
        ctx.drawImage(img, 0, 0);
        const scale = img.naturalWidth / viewportWidth;
        return regs.map((region) => {
          const data = ctx.getImageData(
            Math.round(region.x * scale),
            Math.round(region.y * scale),
            Math.max(Math.round(region.width * scale), 1),
            Math.max(Math.round(region.height * scale), 1),
          ).data;
          const pixels = data.length / 4;
          let matching = 0;
          const offColors: string[] = [];
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i] as number;
            const g = data[i + 1] as number;
            const b = data[i + 2] as number;
            if (
              Math.abs(r - 0x24) <= tolerance &&
              Math.abs(g - 0x2a) <= tolerance &&
              Math.abs(b - 0x33) <= tolerance
            ) {
              matching += 1;
            } else if (offColors.length < 5) {
              offColors.push(`rgb(${r},${g},${b})`);
            }
          }
          return { name: region.name, pixels, matching, offColors };
        });
      },
      { uri: dataUri, regions, viewportWidth: 1280, tolerance: TOLERANCE },
    );

    for (const region of sampled) {
      const ratio = region.matching / region.pixels;
      expect(
        ratio,
        `region ${region.name}: ${region.matching}/${region.pixels} match fill; off-samples ${region.offColors.join(' ')}`,
      ).toBeGreaterThanOrEqual(0.99);
    }
    // Reference sanity: FILL constant matches what we asserted against.
    expect(FILL).toEqual({ r: 0x24, g: 0x2a, b: 0x33 });

    // --- Status walk: Start patch → queued/running → PR → merge →
    // closed. ---
    await page.getByRole('button', { name: 'Start patch' }).click();
    await waitForChipState('patch.running');
    await waitForChipState('pr.opened');

    const job = await api.store.getJobByFeedbackId(feedbackId);
    expect(job?.prNumber).toBeTypeOf('number');
    const merge = await fetch(
      `http://127.0.0.1:8799/_dev/merge/${job?.prNumber}`,
      { method: 'POST' },
    );
    expect(merge.status).toBe(200);
    await waitForChipState('feedback.closed');
    await page.waitForSelector('text=Closed');
  }, 120_000);

  it('runs the clarification branch: question → reply → NEW job advances', async () => {
    await page.goto(PAGE_URL);
    await page.click('.pb-launcher');
    // A fresh page → widget memory is clean → panel view.
    await page.fill(
      '.pb-panel textarea',
      '[clarify] something about the buttons seems off?',
    );
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Send feedback' })
      .click();

    await waitForChipState('feedback.needs_clarification');
    await page.waitForSelector('text=Which exact element do you mean');

    await page.fill(
      '.pb-panel textarea',
      'The Expot CSV button — it should say Export CSV',
    );
    await page.getByRole('button', { name: 'Send answer' }).click();

    // The reply mints a NEW job; polling switches to it and it advances.
    await waitForChipState('feedback.triaged');
    await page.waitForSelector('text=Triaged — ready for a patch');
  }, 120_000);
});
