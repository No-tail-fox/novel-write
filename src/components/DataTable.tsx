import type { ReactNode } from 'react';

export interface DataTableProps {
  label: string;
  columns: readonly ReactNode[];
  state?: ReactNode;
  children: ReactNode;
}

export function DataTable({ label, columns, state, children }: DataTableProps) {
  return (
    <div className="history-table data-table" role="table" aria-label={label}>
      <div className="table-head" role="row">
        {columns.map((column, index) => <span key={index} role="columnheader">{column}</span>)}
      </div>
      <div className="data-table-body" role="rowgroup">
        {state ? (
          <div className="data-table-state-row" role="row">
            <div className="data-table-state-cell" role="cell" aria-colspan={columns.length}>{state}</div>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
