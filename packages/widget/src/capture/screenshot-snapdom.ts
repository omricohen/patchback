import type {
  ScreenshotRenderer,
  ScreenshotRenderOptions,
} from './screenshot.js';

/**
 * The snapdom-backed default renderer — THE ONLY FILE that imports the
 * vendor library, and only via dynamic import at render time. Embedders who
 * never enable screenshots never load a byte of it (a hygiene test pins the
 * absence of static imports).
 *
 * Layer-1 masking runs in snapdom's `afterClone` plugin hook: the detached
 * clone is stripped before any SVG serialization, so masked content never
 * exists in what gets rasterized.
 */
/**
 * snapdom bundles four hardcoded Google-Fonts fallback URLs
 * (Material Icons woff2 on fonts.gstatic.com) that it would fetch at
 * render time for one edge case: Material Symbols rendered with the
 * FILL=1 axis. That is a third-party fetch the widget's no-phone-home
 * posture forbids, so it is disabled via snapdom's documented override
 * global — set to empty strings BEFORE the module evaluates, which makes
 * its fallback lookup falsy and skips the fetch entirely. Cost: that one
 * icon variant may raster in its outlined form. The renderer still
 * inlines resources the PAGE ITSELF references (its own images/fonts) —
 * page-driven loads, not calls the widget initiates.
 */
function suppressVendorIconFontFetches(): void {
  const scope = globalThis as {
    __SNAPDOM_ICON_FONTS__?: Record<string, string>;
  };
  if (scope.__SNAPDOM_ICON_FONTS__ === undefined) {
    scope.__SNAPDOM_ICON_FONTS__ = {
      materialIconsFilled: '',
      materialIconsOutlined: '',
      materialIconsRound: '',
      materialIconsSharp: '',
    };
  }
}

export function createSnapdomRenderer(): ScreenshotRenderer {
  return {
    async render(
      target: Element,
      options: ScreenshotRenderOptions,
    ): Promise<HTMLCanvasElement> {
      suppressVendorIconFontFetches();
      const { snapdom } = await import('@zumer/snapdom');
      const result = await snapdom(target as HTMLElement, {
        fast: true,
        cache: 'soft',
        exclude: [...(options.excludeSelectors ?? [])],
        excludeMode: 'remove',
        ...(options.scale !== undefined ? { scale: options.scale } : {}),
        plugins: [
          {
            name: 'patchback-clone-masking',
            afterClone(context: { clone?: Element | null }): void {
              if (context.clone !== undefined && context.clone !== null) {
                options.onClone(context.clone);
              }
            },
          },
        ],
      });
      return result.toCanvas();
    },
  };
}
