import { WIDGET_CSS } from './styles.js';

/**
 * Widget root: a host <div> on document.body with an OPEN shadow root
 * (open for testability and user debuggability — closed buys no security,
 * only friction). Page CSS cannot bleed in; widget CSS cannot leak out.
 *
 * The host carries `data-patchback-ignore` and `data-patchback-widget`:
 * the masking engine excludes the widget from every capture path, and the
 * screenshot renderer excludes it from rasterization — the widget never
 * captures itself.
 */
export interface WidgetRoot {
  host: HTMLElement;
  shadow: ShadowRoot;
  /** UI container inside the shadow root. */
  container: HTMLElement;
  destroy(): void;
}

export interface WidgetRootOptions {
  theme?: Record<string, string>;
  zIndex?: number;
  document?: Document;
}

export function createWidgetRoot(options: WidgetRootOptions = {}): WidgetRoot {
  const doc = options.document ?? document;
  const host = doc.createElement('div');
  host.setAttribute('data-patchback-widget', '');
  host.setAttribute('data-patchback-ignore', '');
  host.style.position = 'fixed';
  host.style.zIndex = String(options.zIndex ?? 2147483000);
  host.style.inset = 'auto';
  for (const [name, value] of Object.entries(options.theme ?? {})) {
    if (name.startsWith('--patchback-')) {
      host.style.setProperty(name, value);
    }
  }

  const shadow = host.attachShadow({ mode: 'open' });
  injectStyles(shadow, doc);

  const container = doc.createElement('div');
  container.className = 'pb-ui';
  shadow.appendChild(container);

  doc.body.appendChild(host);

  return {
    host,
    shadow,
    container,
    destroy(): void {
      host.remove();
    },
  };
}

function injectStyles(shadow: ShadowRoot, doc: Document): void {
  // Constructed stylesheet when supported; <style> fallback otherwise.
  try {
    const CtorSheet = (
      globalThis as {
        CSSStyleSheet?: new () => CSSStyleSheet & {
          replaceSync?: (css: string) => void;
        };
      }
    ).CSSStyleSheet;
    if (
      CtorSheet !== undefined &&
      'adoptedStyleSheets' in shadow &&
      typeof CtorSheet.prototype.replaceSync === 'function'
    ) {
      const sheet = new CtorSheet();
      sheet.replaceSync?.(WIDGET_CSS);
      shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
      return;
    }
  } catch {
    // Fall through to <style>.
  }
  const style = doc.createElement('style');
  style.textContent = WIDGET_CSS;
  shadow.appendChild(style);
}
