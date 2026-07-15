'use client';

/**
 * The fake internal ops dashboard — the page the demo GIF is shot on.
 *
 * It deliberately ships THREE small, demoable flaws (each a one-line fix,
 * exactly the kind of thing the feedback → triage → agent → PR loop is
 * for). They are catalogued in docs/demo-flow.md at the repo root:
 *
 *   1. Column header typo: "Ammount" should be "Amount" (below).
 *   2. Wrong default sort: oldest orders first (lib/orders.ts, sortOrders).
 *   3. Mislabeled filter: the button says "Pending only" but its filter
 *      actually shows SHIPPED orders (statusForFilter below).
 *
 * The smoke test intentionally does NOT pin these flawed strings/behaviors:
 * a demo PR that fixes one must leave the example's own tests green.
 */
import { useMemo, useState } from 'react';

import {
  formatTotal,
  sortOrders,
  ORDERS,
  type Order,
  type OrderStatus,
} from '../../lib/orders';

/** DELIBERATE DEMO FLAW (mislabeled filter): should be 'pending'. */
function statusForFilter(): OrderStatus {
  return 'shipped';
}

function StatusBadge({ status }: { status: Order['status'] }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export function OrdersDashboard() {
  const [filtered, setFiltered] = useState(false);

  const rows = useMemo(() => {
    const sorted = sortOrders(ORDERS);
    return filtered
      ? sorted.filter((order) => order.status === statusForFilter())
      : sorted;
  }, [filtered]);

  return (
    <section className="dashboard" aria-label="Orders">
      <div className="toolbar">
        <button
          type="button"
          className={filtered ? 'primary' : ''}
          aria-pressed={filtered}
          onClick={() => setFiltered((value) => !value)}
        >
          Pending only
        </button>
        <span className="order-count">
          {rows.length} of {ORDERS.length} orders
        </span>
      </div>

      <table>
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col">Customer</th>
            <th scope="col">Status</th>
            <th scope="col">Placed</th>
            {/* DELIBERATE DEMO FLAW (typo): should read "Amount". */}
            <th scope="col">Ammount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((order) => (
            <tr key={order.id}>
              <td>{order.id}</td>
              <td>{order.customer}</td>
              <td>
                <StatusBadge status={order.status} />
              </td>
              <td>{order.placedAt}</td>
              <td>{formatTotal(order.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
