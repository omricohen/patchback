/**
 * The fake "ops dashboard" the widget is exercised against. Deliberate
 * fixtures:
 *
 * - A button with a typo ("Expot CSV") — the canonical pick-and-patch demo.
 * - Inputs pre-filled with SENTINEL values (text/email/password) — the
 *   acceptance suites assert these never appear in payloads or screenshot
 *   pixels.
 * - A `data-patchback-ignore` card — excluded from picking and capture.
 * - A "Throw console error" button — feeds the (opt-in) console buffer.
 *
 * All names/values are synthetic.
 */
export function renderDemoPage(root: HTMLElement): void {
  root.innerHTML = `
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f2f4f8; color: #16202e; }
      .wrap { max-width: 880px; margin: 0 auto; padding: 32px 20px 120px; }
      h1 { font-size: 22px; }
      .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin: 20px 0; }
      .card { background: #fff; border: 1px solid #dbe2ec; border-radius: 10px; padding: 16px; }
      .card h2 { font-size: 14px; margin: 0 0 10px; }
      label { display: block; font-size: 12px; color: #51607a; margin: 10px 0 4px; }
      input { width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid #c6d0de; border-radius: 6px; font: inherit; }
      table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dbe2ec; border-radius: 10px; overflow: hidden; }
      th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #e8edf4; font-size: 13px; }
      th { background: #f7f9fc; }
      .toolbar { display: flex; gap: 10px; margin: 14px 0; }
      button { font: inherit; padding: 7px 14px; border-radius: 7px; border: 1px solid #c6d0de; background: #fff; cursor: pointer; }
      button.primary { background: #2f6fed; border-color: #2f6fed; color: #fff; }
      .ignored-card { border-style: dashed; background: #fffbe8; }
    </style>
    <div class="wrap">
      <h1>Acme Ops Dashboard <small>(playground fixture)</small></h1>

      <div class="toolbar">
        <button id="export-btn" class="primary">Expot CSV</button>
        <button id="refresh-btn">Refresh</button>
        <button id="boom-btn">Throw console error</button>
      </div>

      <table>
        <thead>
          <tr><th>Order</th><th>Status</th><th>Total</th></tr>
        </thead>
        <tbody>
          <tr><td>#1001</td><td>Shipped</td><td>$140.00</td></tr>
          <tr><td>#1002</td><td>Processing</td><td>$88.50</td></tr>
          <tr><td>#1003</td><td>Draft</td><td>$12.99</td></tr>
        </tbody>
      </table>

      <div class="cards">
        <div class="card">
          <h2>Account form (masked by default)</h2>
          <label for="acct-name">Name</label>
          <input id="acct-name" type="text" value="SENTINEL-name" />
          <label for="acct-email">Email</label>
          <input id="acct-email" type="email" value="sentinel-mail@example.com" />
          <label for="acct-password">Password</label>
          <input id="acct-password" type="password" value="SENTINEL-hunter2" />
          <label for="acct-cc">Card number</label>
          <input id="acct-cc" autocomplete="cc-number" value="0000 0000 0000 0000" />
        </div>

        <div class="card ignored-card" data-patchback-ignore>
          <h2>Internal notes (data-patchback-ignore)</h2>
          <p id="ignored-secret">SENTINEL-internal-note: unpickable, never captured.</p>
        </div>

        <div class="card">
          <h2>Masked copy</h2>
          <p data-patchback-mask id="masked-copy">SENTINEL-account-badge Enterprise</p>
          <p>This paragraph is ordinary visible copy.</p>
        </div>
      </div>
    </div>
  `;

  (root.querySelector('#boom-btn') as HTMLButtonElement).addEventListener(
    'click',
    () => {
      console.error(
        'Demo failure: could not export orders for sentinel-mail@example.com (token sk-000000000000000000000000test)',
      );
    },
  );
  (root.querySelector('#refresh-btn') as HTMLButtonElement).addEventListener(
    'click',
    () => {
      console.warn('Demo warning: refresh is a no-op in the playground');
    },
  );
}
