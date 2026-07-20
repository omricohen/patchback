export interface Row {
  id: string;
  createdAt: number;
}

/** Sort rows oldest-first by creation time. */
export function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => a.createdAt - b.createdAt);
}
