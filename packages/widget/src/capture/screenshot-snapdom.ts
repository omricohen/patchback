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
export function createSnapdomRenderer(): ScreenshotRenderer {
  return {
    async render(
      target: Element,
      options: ScreenshotRenderOptions,
    ): Promise<HTMLCanvasElement> {
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
