import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import type { Policy, PolicyFilter } from "../lib/types";
import { categoryLabel, date, money, relativeDays, statusLabels, urgencyTone } from "../lib/format";
import { DataTable, type Column } from "./DataTable";
import { Badge, Button, EmptyState, Pagination, Spinner, useToast } from "./ui";

export function PolicyTable({
  filter,
  onFilterChange,
  onEdit,
  onRenew,
  onHistory,
  showClient = true,
  emptyTitle = "No policies match",
  emptyDescription = "Adjust the filters, or add a policy.",
}: {
  filter: PolicyFilter;
  onFilterChange: (filter: PolicyFilter) => void;
  onEdit?: (policy: Policy) => void;
  onRenew?: (policy: Policy) => void;
  onHistory?: (policy: Policy) => void;
  showClient?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const policies = useQuery({
    queryKey: ["policies", filter],
    queryFn: () => api.listPolicies(filter),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deletePolicy(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Policy deleted");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const columns: Column<Policy>[] = [
    ...(showClient
      ? [
          {
            key: "client",
            header: "Client",
            sortKey: "client",
            render: (row: Policy) => (
              <span className="block min-w-0">
                <Link
                  to={`/clients/${row.clientId}`}
                  className="block truncate font-medium text-slate-800 hover:text-brand-700"
                >
                  {row.clientName}
                </Link>
                <span className="block truncate text-xs text-slate-400">
                  {row.clientEmail ?? row.clientPhone ?? row.clientCode}
                </span>
              </span>
            ),
          } as Column<Policy>,
        ]
      : []),
    {
      key: "policy",
      header: "Policy",
      sortKey: "policyNumber",
      render: (row) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-slate-700">{row.policyNumber}</span>
          <span className="block truncate text-xs text-slate-400">
            {row.insurerName}
            {row.productName ? ` · ${row.productName}` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "category",
      header: "Type",
      sortKey: "category",
      render: (row) => (
        <span className="text-xs text-slate-600">
          {categoryLabel(row.category)}
          {row.policyYear > 1 && (
            <span className="ml-1 text-slate-400">yr {row.policyYear}</span>
          )}
        </span>
      ),
    },
    {
      key: "expiry",
      header: "Expiry",
      sortKey: "expiry",
      render: (row) => (
        <span className="block">
          <span className="block text-xs text-slate-600">{date(row.expiryDate)}</span>
          <Badge tone={urgencyTone(row.daysToExpiry, row.status)}>
            {row.status === "renewed" ? "Renewed" : relativeDays(row.daysToExpiry)}
          </Badge>
        </span>
      ),
    },
    {
      key: "premium",
      header: "Premium",
      sortKey: "premium",
      align: "right",
      render: (row) => (
        <span className="block">
          <span className="block text-sm text-slate-700">{money(row.premiumAmount)}</span>
          <span className="block text-xs text-slate-400">{money(row.sumInsured)} cover</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (row) => (
        <Badge
          tone={
            row.status === "active"
              ? "ok"
              : row.status === "renewed"
                ? "muted"
                : row.status === "cancelled"
                  ? "muted"
                  : "danger"
          }
        >
          {statusLabels[row.status]}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          {onRenew && row.status !== "renewed" && (
            <Button
              size="sm"
              variant="subtle"
              icon={<RefreshCw className="size-3.5" />}
              onClick={(event) => {
                event.stopPropagation();
                onRenew(row);
              }}
            >
              Renew
            </Button>
          )}
          {onHistory && row.policyYear > 1 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                onHistory(row);
              }}
              aria-label="History"
            >
              <History className="size-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              if (
                window.confirm(
                  `Delete policy ${row.policyNumber}? This removes this policy year permanently.`,
                )
              ) {
                remove.mutate(row.id);
              }
            }}
            aria-label="Delete"
          >
            <Trash2 className="size-3.5 text-slate-400" />
          </Button>
        </div>
      ),
    },
  ];

  if (policies.isLoading) return <Spinner />;

  return (
    <>
      <DataTable
        columns={columns}
        rows={policies.data?.rows ?? []}
        rowKey={(row) => row.id}
        sort={filter.sort}
        descending={filter.descending}
        onSort={(key) =>
          onFilterChange({
            ...filter,
            sort: key,
            descending: filter.sort === key ? !filter.descending : false,
          })
        }
        onRowClick={onEdit}
        empty={
          <EmptyState
            icon={<ShieldCheck className="size-9" />}
            title={emptyTitle}
            description={emptyDescription}
          />
        }
      />
      {policies.data && policies.data.total > 0 && (
        <Pagination
          page={policies.data.page}
          pageSize={policies.data.pageSize}
          total={policies.data.total}
          onPage={(page) => onFilterChange({ ...filter, page })}
        />
      )}
    </>
  );
}
