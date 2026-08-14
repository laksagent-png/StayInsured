import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";

import { cx } from "./ui";

export interface Column<T> {
  key: string;
  header: string;
  /** Sort key understood by the backend; omit to make the column unsortable. */
  sortKey?: string;
  align?: "left" | "right" | "center";
  width?: string;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  descending,
  onSort,
  onRowClick,
  empty,
  dense = false,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  sort?: string;
  descending?: boolean;
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  dense?: boolean;
}) {
  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            {columns.map((column) => {
              const sortable = Boolean(column.sortKey && onSort);
              const active = column.sortKey && sort === column.sortKey;
              return (
                <th
                  key={column.key}
                  style={column.width ? { width: column.width } : undefined}
                  className={cx(
                    "px-3 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase",
                    column.align === "right" && "text-right",
                    column.align === "center" && "text-center",
                    !column.align && "text-left",
                    sortable && "cursor-pointer select-none hover:text-slate-700",
                  )}
                  onClick={() => sortable && onSort?.(column.sortKey!)}
                >
                  <span
                    className={cx(
                      "inline-flex items-center gap-1",
                      column.align === "right" && "flex-row-reverse",
                    )}
                  >
                    {column.header}
                    {active &&
                      (descending ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronUp className="size-3.5" />
                      ))}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={() => onRowClick?.(row)}
              className={cx(
                "border-b border-slate-100 last:border-0",
                onRowClick && "cursor-pointer",
                "hover:bg-brand-50/40",
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cx(
                    dense ? "px-3 py-1.5" : "px-3 py-2.5",
                    "text-slate-700",
                    column.align === "right" && "text-right",
                    column.align === "center" && "text-center",
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
