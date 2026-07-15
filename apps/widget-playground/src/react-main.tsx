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

function App() {
  return (
    <PatchbackProvider config={CONFIG}>
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
