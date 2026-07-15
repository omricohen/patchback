/**
 * A tiny static page so there is something to give feedback ABOUT.
 * One deliberate demo flaw: the release notes header says "Whats new"
 * (missing apostrophe) — a one-line fix for the feedback → PR loop.
 * The smoke test does not pin the flawed string.
 */
export function renderPage(root: HTMLElement): void {
  root.innerHTML = `
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f2f4f8; color: #16202e; }
      .wrap { max-width: 640px; margin: 0 auto; padding: 32px 20px 120px; }
      .card { background: #fff; border: 1px solid #dbe2ec; border-radius: 10px; padding: 16px; margin-top: 16px; }
      .note { font-size: 13px; color: #51607a; }
    </style>
    <div class="wrap">
      <h1>Vite demo</h1>
      <p class="note">
        A minimal vanilla app embedding the Patchback widget. All content is
        synthetic.
      </p>
      <div class="card">
        <h2>Whats new</h2>
        <ul>
          <li>Orders can be exported as CSV.</li>
          <li>Invoices now show the payment due date.</li>
        </ul>
      </div>
      <div class="card" id="patchback-note"></div>
    </div>
  `;
}

export function renderSetupNote(root: HTMLElement, message: string): void {
  const note = root.querySelector('#patchback-note');
  if (note !== null) {
    note.textContent = message;
  }
}
