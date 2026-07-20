/**
 * All widget CSS as one string, injected into the shadow root. No CSS
 * files, no CDN fonts/icons — system font stack and inline SVG only
 * (no-telemetry posture: zero external fetches).
 *
 * Theming: `--patchback-*` custom properties set on the HOST pierce the
 * shadow boundary by design.
 */
export const WIDGET_CSS = `
:host {
  all: initial;
}
* { box-sizing: border-box; }
.pb-ui {
  font-family: var(--patchback-font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: 14px;
  line-height: 1.45;
  color: var(--patchback-fg, #1a2230);
}
button { font: inherit; cursor: pointer; }

.pb-launcher {
  position: fixed;
  right: var(--patchback-offset-x, 20px);
  bottom: var(--patchback-offset-y, 20px);
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: var(--patchback-accent, #2f6fed);
  color: #fff;
  box-shadow: 0 4px 14px rgba(16, 30, 60, 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pb-launcher:hover { filter: brightness(1.08); }
.pb-launcher svg { width: 24px; height: 24px; }

.pb-panel {
  position: fixed;
  right: var(--patchback-offset-x, 20px);
  bottom: calc(var(--patchback-offset-y, 20px) + 64px);
  width: min(360px, calc(100vw - 32px));
  max-height: min(600px, calc(100vh - 96px));
  overflow-y: auto;
  background: var(--patchback-bg, #ffffff);
  color: var(--patchback-fg, #1a2230);
  border: 1px solid var(--patchback-border, #d7dde8);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(16, 30, 60, 0.22);
  padding: 16px;
}
.pb-panel h2 { font-size: 15px; margin: 0 0 10px; }
.pb-panel textarea {
  width: 100%;
  min-height: 84px;
  resize: vertical;
  font: inherit;
  color: inherit;
  background: var(--patchback-bg, #fff);
  border: 1px solid var(--patchback-border, #d7dde8);
  border-radius: 8px;
  padding: 8px;
}
.pb-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.pb-btn {
  border: 1px solid var(--patchback-border, #d7dde8);
  background: var(--patchback-bg, #fff);
  color: inherit;
  border-radius: 8px;
  padding: 6px 10px;
}
.pb-btn:hover { background: rgba(47, 111, 237, 0.06); }
.pb-btn-primary {
  background: var(--patchback-accent, #2f6fed);
  border-color: var(--patchback-accent, #2f6fed);
  color: #fff;
}
.pb-btn-primary:disabled { opacity: 0.55; cursor: default; }
.pb-btn-link {
  border: none;
  background: none;
  color: var(--patchback-accent, #2f6fed);
  padding: 0;
  text-decoration: underline;
}

.pb-preview {
  margin-top: 12px;
  border: 1px solid var(--patchback-border, #d7dde8);
  border-radius: 8px;
  padding: 10px;
  background: var(--patchback-muted-bg, #f6f8fb);
}
.pb-preview h3 { font-size: 12px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--patchback-muted-fg, #5a6478); }
.pb-preview ul { margin: 0; padding: 0; list-style: none; }
.pb-preview li {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 3px 0;
  word-break: break-word;
}
.pb-preview .pb-field { font-weight: 600; white-space: nowrap; }
.pb-preview img { max-width: 100%; border-radius: 6px; border: 1px solid var(--patchback-border, #d7dde8); }
.pb-remove {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--patchback-muted-fg, #5a6478);
  padding: 0 2px;
}
.pb-remove:hover { color: #b3261e; }
.pb-console-list { max-height: 120px; overflow-y: auto; font-family: ui-monospace, monospace; font-size: 11px; }

.pb-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 600;
  background: #eef1f6;
  color: #3a4257;
}
.pb-chip::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
.pb-chip[data-tone="info"] { background: #e7efff; color: #1d4fbe; }
.pb-chip[data-tone="progress"] { background: #e7efff; color: #1d4fbe; }
.pb-chip[data-tone="attention"] { background: #fff3d6; color: #8a5a00; }
.pb-chip[data-tone="warning"] { background: #fde5e2; color: #a1372c; }
.pb-chip[data-tone="success"] { background: #e0f2e5; color: #226b37; }
.pb-chip[data-pulse]::before { animation: pb-pulse 1.2s ease-in-out infinite; }
@keyframes pb-pulse { 50% { opacity: 0.25; } }

.pb-thread-msg {
  background: var(--patchback-muted-bg, #f6f8fb);
  border-radius: 8px;
  padding: 8px 10px;
  margin: 8px 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.pb-question {
  border-left: 3px solid #d99a00;
  background: #fff8e6;
  padding: 8px 10px;
  border-radius: 0 8px 8px 0;
  margin: 8px 0;
}
.pb-history { margin: 8px 0 0; padding-left: 16px; font-size: 12px; color: var(--patchback-muted-fg, #5a6478); }
.pb-error { color: #a1372c; margin-top: 8px; }
.pb-muted { color: var(--patchback-muted-fg, #5a6478); font-size: 12px; }
a.pb-pr-link { color: var(--patchback-accent, #2f6fed); }
a.pb-preview-link { color: var(--patchback-accent, #2f6fed); }

.pb-ai-summary {
  margin: 8px 0;
  border-left: 3px solid var(--patchback-accent, #2f6fed);
  background: var(--patchback-muted-bg, #f6f8fb);
  padding: 8px 10px;
  border-radius: 0 8px 8px 0;
}
.pb-ai-summary strong {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--patchback-muted-fg, #5a6478);
  margin-bottom: 4px;
}
.pb-ai-summary p { margin: 0; word-break: break-word; }

.pb-picker-overlay {
  position: fixed;
  inset: 0;
  cursor: crosshair;
  background: rgba(20, 30, 50, 0.05);
}
.pb-picker-box {
  position: fixed;
  border: 2px solid var(--patchback-accent, #2f6fed);
  border-radius: 3px;
  background: rgba(47, 111, 237, 0.12);
  pointer-events: none;
}
.pb-picker-box[data-excluded] {
  border-color: #b3261e;
  background: repeating-linear-gradient(45deg, rgba(179,38,30,.15), rgba(179,38,30,.15) 6px, transparent 6px, transparent 12px);
}
.pb-picker-label {
  position: fixed;
  transform: translateY(-100%);
  background: #1a2230;
  color: #fff;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  pointer-events: none;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pb-visually-hidden {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px; padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
`;
