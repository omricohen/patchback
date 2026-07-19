import { readFileSync } from 'node:fs';
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
const REACT_PAGE_URL = `http://127.0.0.1:${VITE_PORT}/react.html`;

/** Repo-root-relative path of the annotated react page source. */
const REACT_MAIN_RELATIVE = 'apps/widget-playground/src/react-main.tsx';

/**
 * The 1-based line the dev transform stamps for a JSX element: the line
 * where its opening tag STARTS. Computed from the source at test runtime —
 * scan for the marker attribute, then walk up to the nearest opening tag —
 * so nothing here rots when react-main.tsx is edited or reformatted.
 */
function expectedJsxLine(markerAttribute: string, tagName: string): number {
  const source = readFileSync(join(ROOT, 'src', 'react-main.tsx'), 'utf8');
  const lines = source.split('\n');
  const markerIndex = lines.findIndex((line) => line.includes(markerAttribute));
  if (markerIndex === -1) {
    throw new Error(`marker ${markerAttribute} not found in react-main.tsx`);
  }
  for (let i = markerIndex; i >= 0; i -= 1) {
    if ((lines[i] as string).includes(`<${tagName}`)) {
      return i + 1;
    }
  }
  throw new Error(`no <${tagName} above marker ${markerAttribute}`);
}

/** The redaction fill (REDACTION_FILL in the widget) as RGB. */
const FILL = { r: 0x24, g: 0x2a, b: 0x33 };
/** Lossy WebP/JPEG headroom per channel. */
const TOLERANCE = 14;

interface CloseableViteServer {
  listen(): Promise<unknown>;
  close(): Promise<void>;
}

interface SampleRegion {
  name: string;
  /** Viewport-space CSS px, measured at capture time. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Color to count matches against (within TOLERANCE). */
  color: { r: number; g: number; b: number };
  /** Minimum fraction of pixels that must match `color`. */
  minRatio?: number;
  /** Maximum fraction of pixels allowed to match `color` (leak checks). */
  maxRatio?: number;
}

interface SampleOutcome {
  name: string;
  pixels: number;
  matching: number;
  offColors: string[];
  minRatio?: number;
  maxRatio?: number;
}

interface DecodedSample {
  width: number;
  height: number;
  results: SampleOutcome[];
}

/** Inset a box so edge anti-aliasing never skews the uniformity check. */
function inset(
  box: { x: number; y: number; width: number; height: number },
  by = 4,
): { x: number; y: number; width: number; height: number } {
  return {
    x: box.x + by,
    y: box.y + by,
    width: Math.max(box.width - 2 * by, 1),
    height: Math.max(box.height - 2 * by, 1),
  };
}

/**
 * Decode a screenshot data URI in the browser and sample pixel regions.
 * Screenshots are VIEWPORT captures, so viewport-space CSS px map to image
 * px via naturalWidth / viewportWidth.
 */
async function decodeAndSample(
  page: Page,
  dataUri: string,
  regions: SampleRegion[],
  viewportWidth: number,
): Promise<DecodedSample> {
  return page.evaluate(
    async ({ uri, regs, vw, tolerance }) => {
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
      const scale = img.naturalWidth / vw;
      const results = regs.map((region) => {
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
            Math.abs(r - region.color.r) <= tolerance &&
            Math.abs(g - region.color.g) <= tolerance &&
            Math.abs(b - region.color.b) <= tolerance
          ) {
            matching += 1;
          } else if (offColors.length < 5) {
            offColors.push(`rgb(${r},${g},${b})`);
          }
        }
        return {
          name: region.name,
          pixels,
          matching,
          offColors,
          ...(region.minRatio !== undefined
            ? { minRatio: region.minRatio }
            : {}),
          ...(region.maxRatio !== undefined
            ? { maxRatio: region.maxRatio }
            : {}),
        };
      });
      return { width: img.naturalWidth, height: img.naturalHeight, results };
    },
    { uri: dataUri, regs: regions, vw: viewportWidth, tolerance: TOLERANCE },
  );
}

function assertRegions(sample: DecodedSample): void {
  for (const region of sample.results) {
    const ratio = region.matching / region.pixels;
    const detail = `region ${region.name}: ${region.matching}/${region.pixels} pixels match; off-samples ${region.offColors.join(' ')}`;
    if (region.minRatio !== undefined) {
      expect(ratio, detail).toBeGreaterThanOrEqual(region.minRatio);
    }
    if (region.maxRatio !== undefined) {
      expect(ratio, detail).toBeLessThanOrEqual(region.maxRatio);
    }
  }
}

/** The screenshot must be a VIEWPORT capture, never the full document. */
function assertViewportSized(sample: DecodedSample): void {
  const aspect = sample.width / sample.height;
  expect(
    Math.abs(aspect - 1280 / 900),
    `screenshot ${sample.width}x${sample.height} is not viewport-shaped — full-document raster leaked through`,
  ).toBeLessThan(0.05);
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
    // NEGATIVE CONTROL: the vanilla page has no provenance plugin and no
    // manual data-pb-source attributes — the payload must stay hint-free,
    // with no sourceHint key at all.
    expect(
      'sourceHint' in
        ((item?.capture?.element ?? {}) as Record<string, unknown>),
    ).toBe(false);

    // --- Screenshot pixel proof: masked regions are UNIFORMLY the
    // redaction fill. ---
    const shot = item?.capture?.screenshot;
    expect(shot?.masked).toBe(true);
    const dataUri = shot?.dataUri ?? '';
    expect(dataUri.startsWith('data:image/')).toBe(true);
    expect(dataUri.length).toBeLessThanOrEqual(524288);

    const sampled = await decodeAndSample(
      page,
      dataUri,
      [
        {
          name: 'password',
          ...inset(pwBox ?? { x: 0, y: 0, width: 1, height: 1 }),
          color: FILL,
          minRatio: 0.99,
        },
        {
          name: 'ignored-card',
          ...inset(ignoredBox ?? { x: 0, y: 0, width: 1, height: 1 }),
          color: FILL,
          minRatio: 0.99,
        },
      ],
      1280,
    );
    assertViewportSized(sampled);
    assertRegions(sampled);

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

  it('provenance: picking an annotated JSX element carries the REAL file:line', async () => {
    await page.goto(REACT_PAGE_URL);

    // The dev transform must have stamped the JSX button with the
    // repo-root-relative path (root discovery proof: the vite root is
    // apps/widget-playground, but the stamp is repo-relative).
    const stamped = await page
      .locator('#pb-typo-btn')
      .getAttribute('data-pb-source');
    const expectedButtonLine = expectedJsxLine('id="pb-typo-btn"', 'button');
    expect(stamped).toBe(`${REACT_MAIN_RELATIVE}:${expectedButtonLine}`);

    await page.getByRole('button', { name: 'Feedback (React)' }).click();
    await page.fill(
      '.pb-panel textarea',
      'The JSON export button says "Expot" instead of "Export"',
    );
    await page.getByRole('button', { name: 'Point at the problem' }).click();
    // The React strip renders below the vanilla dashboard — bring the
    // target into the viewport (the picker works in client coordinates).
    await page.locator('#pb-typo-btn').scrollIntoViewIfNeeded();
    const target = await page.locator('#pb-typo-btn').boundingBox();
    expect(target).not.toBeNull();
    const cx = (target?.x ?? 0) + (target?.width ?? 0) / 2;
    const cy = (target?.y ?? 0) + (target?.height ?? 0) / 2;
    await page.mouse.move(cx, cy);
    await page.waitForSelector('.pb-picker-box');
    await page.mouse.click(cx, cy);
    await page.waitForSelector('[data-preview="element"]');

    // GESTURE CONSENT SURFACE: the hint is visible in the "What will be
    // sent" preview before anything is submitted.
    const previewSource = await page
      .locator('[data-preview-source]')
      .textContent();
    expect(previewSource).toContain(
      `source: ${REACT_MAIN_RELATIVE}:${expectedButtonLine}`,
    );

    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Send feedback' })
      .click();
    await waitForChipState('feedback.triaged');

    const feedbackId = api.createdFeedbackIds.at(-1) as string;
    const item = await api.store.getFeedback(feedbackId);
    expect(item?.capture?.element?.domPath).toBe('#pb-typo-btn');
    const hint = item?.capture?.element?.sourceHint;
    // Repo-relative shape…
    expect(hint).toMatch(/^apps\/widget-playground\/src\/react-main\.tsx:\d+$/);
    // …and the EXACT line computed from the source file at test runtime.
    expect(hint).toBe(`${REACT_MAIN_RELATIVE}:${expectedButtonLine}`);
    // The stored payload never carries an absolute path anywhere.
    expect(JSON.stringify(item)).not.toContain(ROOT);
  }, 120_000);

  it('provenance: a raw-HTML child falls back to the annotated ANCESTOR', async () => {
    await page.goto(REACT_PAGE_URL);

    // The dangerouslySetInnerHTML child itself is unstamped…
    const childStamp = await page
      .locator('#pb-html-child')
      .getAttribute('data-pb-source');
    expect(childStamp).toBeNull();
    // …its wrapper (real JSX) is stamped.
    const wrapperLine = expectedJsxLine('id="pb-html-wrapper"', 'div');

    await page.getByRole('button', { name: 'Feedback (React)' }).click();
    await page.fill('.pb-panel textarea', 'The raw HTML child looks off');
    await page.getByRole('button', { name: 'Point at the problem' }).click();
    await page.locator('#pb-html-child').scrollIntoViewIfNeeded();
    const target = await page.locator('#pb-html-child').boundingBox();
    expect(target).not.toBeNull();
    const cx = (target?.x ?? 0) + (target?.width ?? 0) / 2;
    const cy = (target?.y ?? 0) + (target?.height ?? 0) / 2;
    await page.mouse.move(cx, cy);
    await page.waitForSelector('.pb-picker-box');
    await page.mouse.click(cx, cy);
    await page.waitForSelector('[data-preview="element"]');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Send feedback' })
      .click();
    await waitForChipState('feedback.triaged');

    const feedbackId = api.createdFeedbackIds.at(-1) as string;
    const item = await api.store.getFeedback(feedbackId);
    expect(item?.capture?.element?.domPath).toBe('#pb-html-child');
    expect(item?.capture?.element?.sourceHint).toBe(
      `${REACT_MAIN_RELATIVE}:${wrapperLine}`,
    );
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

  it('redacts below-fold masked MEDIA in a SCROLLED capture (geometry regression)', async () => {
    await page.goto(PAGE_URL);
    await page.locator('#fold-section').scrollIntoViewIfNeeded();

    // Viewport-space geometry AFTER scrolling — the exact coordinates the
    // widget must redact at, far from document-space y.
    const geometry = await page.evaluate(() => {
      const box = (selector: string) => {
        const el = document.querySelector(selector);
        if (el === null) {
          throw new Error(`missing fixture ${selector}`);
        }
        const rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        img: box('#fold-masked-img'),
        bg: box('#fold-bg-masked'),
        control: box('#fold-control'),
        pw: box('#fold-password'),
        scrollY: window.scrollY,
      };
    });
    // The regression only exists when genuinely scrolled.
    expect(geometry.scrollY).toBeGreaterThan(500);

    await page.click('.pb-launcher');
    await page.fill('.pb-panel textarea', 'Below-fold masked media check');
    await page.getByRole('button', { name: 'Attach screenshot' }).click();
    await page.waitForSelector('[data-preview="screenshot"] img', {
      timeout: 30_000,
    });
    // The renderer scrolls the document to rasterize it; the widget must
    // put the user back where they were.
    expect(await page.evaluate(() => window.scrollY)).toBe(geometry.scrollY);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Send feedback' })
      .click();
    await waitForChipState('feedback.triaged');

    const feedbackId = api.createdFeedbackIds.at(-1) as string;
    const item = await api.store.getFeedback(feedbackId);
    expect(item).toBeDefined();
    expect(JSON.stringify(item)).not.toContain('SENTINEL');

    const shot = item?.capture?.screenshot;
    expect(shot?.masked).toBe(true);
    const dataUri = shot?.dataUri ?? '';
    expect(dataUri.startsWith('data:image/')).toBe(true);

    const sampled = await decodeAndSample(
      page,
      dataUri,
      [
        // Masked <img> (bright magenta in the DOM) → uniform redaction
        // fill. inset(1): layer 2 rounds outward, so even the outermost
        // sampled rows must be fill — a leading-edge sliver fails here.
        {
          name: 'masked-img',
          ...inset(geometry.img, 1),
          color: FILL,
          minRatio: 0.99,
        },
        // Masked CSS background-image (bright orange) → uniform fill.
        {
          name: 'masked-bg',
          ...inset(geometry.bg, 1),
          color: FILL,
          minRatio: 0.99,
        },
        // Below-fold password input → uniform fill.
        {
          name: 'below-fold-password',
          ...inset(geometry.pw, 1),
          color: FILL,
          minRatio: 0.99,
        },
        // The UNMASKED control block must stay green: proves the crop is
        // aligned and no redaction fill smeared onto innocent pixels.
        {
          name: 'unmasked-control',
          ...inset(geometry.control),
          color: { r: 0x0a, g: 0x7d, b: 0x33 },
          minRatio: 0.9,
        },
      ],
      1280,
    );
    // The capture must be the viewport the user saw, not the full document.
    assertViewportSized(sampled);
    assertRegions(sampled);
  }, 120_000);

  it('layer 1 ALONE redacts masked CSS backgrounds and media (layer 2 disabled)', async () => {
    // The two-layer guarantee, TESTED rather than asserted: with raster
    // painting switched off via the test-only global (not reachable from
    // public config), a capture must ALREADY contain no masked content —
    // including CSS backgrounds, which snapdom re-inlines from the live
    // element and which only the clone-stage inset shadow covers here.
    await page.goto(PAGE_URL);
    await page.locator('#fold-section').scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      (
        window as unknown as Record<string, unknown>
      ).__PATCHBACK_TEST_ONLY_DISABLE_RASTER_REDACTION__ = true;
    });
    try {
      const geometry = await page.evaluate(() => {
        const box = (selector: string) => {
          const el = document.querySelector(selector);
          if (el === null) {
            throw new Error(`missing fixture ${selector}`);
          }
          const rect = el.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        };
        return {
          img: box('#fold-masked-img'),
          bg: box('#fold-bg-masked'),
          control: box('#fold-control'),
          pw: box('#fold-password'),
        };
      });

      await page.click('.pb-launcher');
      await page.fill('.pb-panel textarea', 'Layer-1-only redaction check');
      await page.getByRole('button', { name: 'Attach screenshot' }).click();
      await page.waitForSelector('[data-preview="screenshot"] img', {
        timeout: 30_000,
      });
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Send feedback' })
        .click();
      await waitForChipState('feedback.triaged');

      const feedbackId = api.createdFeedbackIds.at(-1) as string;
      const item = await api.store.getFeedback(feedbackId);
      const dataUri = item?.capture?.screenshot?.dataUri ?? '';
      expect(dataUri.startsWith('data:image/')).toBe(true);

      const sampled = await decodeAndSample(
        page,
        dataUri,
        [
          // The masked CSS background must NOT be its source color…
          {
            name: 'masked-bg is not its source orange (layer 1 only)',
            ...inset(geometry.bg),
            color: { r: 0xff, g: 0x88, b: 0x00 },
            maxRatio: 0.02,
          },
          // …and IS the redaction fill (the clone-stage inset shadow).
          {
            name: 'masked-bg is redaction fill (layer 1 only)',
            ...inset(geometry.bg),
            color: FILL,
            minRatio: 0.95,
          },
          // The masked <img> must not leak its source magenta.
          {
            name: 'masked-img is not its source magenta (layer 1 only)',
            ...inset(geometry.img),
            color: { r: 0xff, g: 0x00, b: 0xaa },
            maxRatio: 0.02,
          },
          // The password box is value-stripped + shadow-filled by layer 1.
          {
            name: 'password is redaction fill (layer 1 only)',
            ...inset(geometry.pw),
            color: FILL,
            minRatio: 0.9,
          },
          // Unmasked content stays intact without layer 2 as well.
          {
            name: 'unmasked control stays green (layer 1 only)',
            ...inset(geometry.control),
            color: { r: 0x0a, g: 0x7d, b: 0x33 },
            minRatio: 0.9,
          },
        ],
        1280,
      );
      assertViewportSized(sampled);
      assertRegions(sampled);
    } finally {
      await page.evaluate(() => {
        delete (window as unknown as Record<string, unknown>)
          .__PATCHBACK_TEST_ONLY_DISABLE_RASTER_REDACTION__;
      });
    }
  }, 120_000);
});
