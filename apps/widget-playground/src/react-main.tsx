import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import {
  PatchbackLauncher,
  PatchbackProvider,
  usePatchbackStatus,
} from '@patchback/react';
import type { PatchbackWidgetConfig } from '@patchback/react';

import { renderDemoPage } from './demo-page.js';

renderDemoPage(document.querySelector('#demo-root') as HTMLElement);

// Hoisted: PatchbackProvider compares config by identity.
const CONFIG: PatchbackWidgetConfig = {
  apiUrl: '/api',
  apiKey: 'pb_dev_insider_key_000000',
  capture: { page: true, screenshot: true, console: true },
  polling: { fastMs: 700, slowMs: 1200 },
  launcher: false, // Custom launcher below.
};

function StatusBar() {
  const status = usePatchbackStatus();
  return (
    <div style={{ position: 'fixed', left: 16, bottom: 16, fontSize: 13 }}>
      {status === null ? 'No job yet' : `Job ${status.jobId}: ${status.state}`}
    </div>
  );
}

/**
 * JSX demo strip — the annotated pick targets for the provenance flow.
 * In dev every host element here carries `data-pb-source="<file>:<line>"`
 * stamped by @patchback/provenance. The raw-HTML child (below) is rendered
 * via dangerouslySetInnerHTML, so it has NO stamp of its own — picking it
 * exercises the nearest-annotated-ancestor fallback.
 */
function DemoToolbar() {
  return (
    <section
      id="jsx-demo"
      style={{
        margin: '16px auto',
        maxWidth: 880,
        padding: '12px 20px',
        background: '#fff',
        border: '1px solid #dbe2ec',
        borderRadius: 10,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <h2 style={{ fontSize: 14, margin: '0 0 10px' }}>
        React toolbar (annotated in dev)
      </h2>
      <button id="pb-typo-btn" type="button">
        Expot JSON
      </button>
      <div
        id="pb-html-wrapper"
        dangerouslySetInnerHTML={{
          __html:
            '<span id="pb-html-child">raw HTML child (no JSX, no stamp)</span>',
        }}
      />
    </section>
  );
}

function App() {
  return (
    <PatchbackProvider config={CONFIG}>
      <DemoToolbar />
      <div style={{ position: 'fixed', right: 16, bottom: 16 }}>
        <PatchbackLauncher>Feedback (React)</PatchbackLauncher>
      </div>
      <StatusBar />
    </PatchbackProvider>
  );
}

createRoot(document.querySelector('#react-root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
