/**
 * Fake seeded orders for the demo dashboard. All names are generic and
 * synthetic — nothing here refers to a real company or person.
 */
export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'cancelled';

export interface Order {
  id: string;
  customer: string;
  status: OrderStatus;
  /** Cents, to keep the fake math exact. */
  totalCents: number;
  /** ISO date the order was placed. */
  placedAt: string;
}

export const ORDERS: Order[] = [
  {
    id: 'ORD-1041',
    customer: 'Acme Supply Co',
    status: 'pending',
    totalCents: 48_250,
    placedAt: '2026-07-14',
  },
  {
    id: 'ORD-1040',
    customer: 'Blue Harbor Foods',
    status: 'processing',
    totalCents: 129_900,
    placedAt: '2026-07-13',
  },
  {
    id: 'ORD-1039',
    customer: 'Cascade Tooling',
    status: 'shipped',
    totalCents: 8_499,
    placedAt: '2026-07-12',
  },
  {
    id: 'ORD-1038',
    customer: 'Dockside Freight',
    status: 'pending',
    totalCents: 23_000,
    placedAt: '2026-07-11',
  },
  {
    id: 'ORD-1037',
    customer: 'Evergreen Textiles',
    status: 'shipped',
    totalCents: 310_575,
    placedAt: '2026-07-09',
  },
  {
    id: 'ORD-1036',
    customer: 'Foundry Metals',
    status: 'cancelled',
    totalCents: 15_120,
    placedAt: '2026-07-07',
  },
  {
    id: 'ORD-1035',
    customer: 'Granite Office Supply',
    status: 'shipped',
    totalCents: 61_040,
    placedAt: '2026-07-05',
  },
  {
    id: 'ORD-1034',
    customer: 'Harbor Light Coffee',
    status: 'processing',
    totalCents: 4_875,
    placedAt: '2026-07-02',
  },
];

export function formatTotal(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * DELIBERATE DEMO FLAW (sort): an ops dashboard should show the NEWEST
 * orders first, but this sorts oldest-first. It exists so a feedback →
 * triage → agent → PR demo has something small and real to fix. See
 * docs/demo-flow.md at the repo root.
 */
export function sortOrders(orders: Order[]): Order[] {
  return [...orders].sort((a, b) => a.placedAt.localeCompare(b.placedAt));
}
