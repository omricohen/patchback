export function Sidebar({ ready }: { ready: boolean }): JSX.Element {
  return (
    <nav className="sidebar">
      {!ready && <span className="sidebar-status">Loading data</span>}
      <ul>
        <li>
          <a href="/orders">Orders</a>
        </li>
        <li>
          <a href="/settings">Settings</a>
        </li>
      </ul>
    </nav>
  );
}
