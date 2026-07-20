interface Row {
  id: string;
  date: string;
  description: string;
  total: number;
}

export function InvoiceTable({ rows }: { rows: Row[] }): JSX.Element {
  return (
    <table className="invoice-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{row.date}</td>
            <td>{row.description}</td>
            <td>{row.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
