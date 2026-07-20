export function StatusBadge({ state }: { state: string }): JSX.Element {
  if (state === 'loading') {
    return <span className="badge badge-loading">Loading data</span>;
  }
  if (state === 'error') {
    return <span className="badge badge-error">Something went wrong</span>;
  }
  return <span className="badge">{state}</span>;
}
