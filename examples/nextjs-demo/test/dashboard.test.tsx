/**
 * Smoke tests for the demo dashboard.
 *
 * IMPORTANT: these deliberately do NOT assert on the seeded demo flaws
 * (the "Ammount" typo, the oldest-first sort, the mislabeled filter) —
 * the whole point of the flaws is that a Patchback demo PR fixes one,
 * and that PR must leave this example's tests green.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OrdersDashboard } from '../app/components/orders-dashboard';
import { PatchbackSnippet } from '../app/components/patchback-snippet';
import OrdersPage from '../app/page';
import { ORDERS, formatTotal } from '../lib/orders';

afterEach(cleanup);

describe('OrdersPage', () => {
  it('renders the dashboard heading and the orders table', () => {
    render(<OrdersPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Acme Ops' }),
    ).toBeDefined();
    expect(screen.getByRole('table')).toBeDefined();
  });
});

describe('OrdersDashboard', () => {
  it('renders one row per seeded order', () => {
    render(<OrdersDashboard />);
    const rows = screen.getAllByRole('row');
    // Header row + one row per order.
    expect(rows).toHaveLength(ORDERS.length + 1);
    for (const order of ORDERS) {
      expect(screen.getByText(order.customer)).toBeDefined();
    }
  });

  it('formats totals as dollars', () => {
    render(<OrdersDashboard />);
    for (const order of ORDERS) {
      expect(screen.getByText(formatTotal(order.totalCents))).toBeDefined();
    }
  });

  it('has a status filter toggle', () => {
    render(<OrdersDashboard />);
    const toggle = screen.getByRole('button', { pressed: false });
    expect(toggle).toBeDefined();
  });
});

describe('PatchbackSnippet', () => {
  it('renders the setup note when no dev key is configured', () => {
    // NEXT_PUBLIC_* vars are undefined under vitest — the component must
    // degrade to instructions instead of loading the widget.
    render(<PatchbackSnippet />);
    expect(screen.getByRole('note').textContent).toContain('patchback dev');
    expect(document.querySelector('script[src*="widget.js"]')).toBeNull();
  });
});
