import { OrdersDashboard } from './components/orders-dashboard';

export default function OrdersPage() {
  return (
    <main className="wrap">
      <header className="page-header">
        <h1>Acme Ops</h1>
        <p className="subtitle">
          Orders — internal dashboard (demo fixture, all data synthetic)
        </p>
      </header>
      <OrdersDashboard />
    </main>
  );
}
