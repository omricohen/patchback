export function OrderSummary(): JSX.Element {
  return (
    <section className="order-summary">
      <h2>Order Summary</h2>
      <dl>
        <dt>Subtotal</dt>
        <dd>$120.00</dd>
        <dt>Tax</dt>
        <dd>$9.60</dd>
        <dt className="total-label">Ammount Due</dt>
        <dd className="total-value">$129.60</dd>
      </dl>
    </section>
  );
}
