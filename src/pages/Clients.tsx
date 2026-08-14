import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, Plus, Search, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import type { Client, ClientFilter } from "../lib/types";
import { count, date, initials } from "../lib/format";
import { ClientForm } from "../components/ClientForm";
import { DataTable, type Column } from "../components/DataTable";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Input,
  Pagination,
  Select,
  Spinner,
  useToast,
} from "../components/ui";

export function ClientsPage() {
  const [params] = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<ClientFilter>({
    page: 1,
    pageSize: 25,
    sort: "name",
    missingEmail: params.get("missingEmail") === "1",
  });
  const [searchText, setSearchText] = useState("");
  const [editing, setEditing] = useState<Client | undefined>();
  const [formOpen, setFormOpen] = useState(false);

  // Debounced so typing does not fire a query per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(
      () => setFilter((current) => ({ ...current, search: searchText, page: 1 })),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const clients = useQuery({
    queryKey: ["clients", filter],
    queryFn: () => api.listClients(filter),
  });
  const cities = useQuery({ queryKey: ["cities"], queryFn: api.cities });
  const categories = useQuery({ queryKey: ["categories"], queryFn: api.categories });

  const exportRows = useMutation({
    mutationFn: async () => {
      const path = await save({
        title: "Export clients",
        defaultPath: "clients.xlsx",
        filters: [
          { name: "Excel", extensions: ["xlsx"] },
          { name: "CSV", extensions: ["csv"] },
        ],
      });
      if (!path) return 0;
      return api.exportClients(filter, path);
    },
    onSuccess: (rows) => rows > 0 && toast.success(`Exported ${count(rows)} clients`),
    onError: (err: ApiError) => toast.error(err.message),
  });

  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      api.setClientArchived(id, archived),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Client updated");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const columns: Column<Client>[] = [
    {
      key: "name",
      header: "Client",
      sortKey: "name",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
            {initials(row.fullName)}
          </span>
          <span className="min-w-0">
            <Link
              to={`/clients/${row.id}`}
              className="block truncate font-medium text-slate-800 hover:text-brand-700"
            >
              {row.fullName}
            </Link>
            <span className="block truncate text-xs text-slate-400">
              {row.clientCode}
              {row.city ? ` · ${row.city}` : ""}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      render: (row) => (
        <span className="block text-xs">
          <span className={row.email ? "text-slate-600" : "text-amber-600"}>
            {row.email ?? "No email"}
          </span>
          <span className="block text-slate-400">{row.phone ?? "—"}</span>
        </span>
      ),
    },
    {
      key: "policies",
      header: "Policies",
      sortKey: "policies",
      align: "center",
      render: (row) => (
        <span className="text-sm">
          <strong className="text-slate-700">{row.activePolicies}</strong>
          <span className="text-slate-400"> / {row.totalPolicies}</span>
        </span>
      ),
    },
    {
      key: "nextExpiry",
      header: "Next expiry",
      sortKey: "nextExpiry",
      render: (row) => <span className="text-xs text-slate-600">{date(row.nextExpiry)}</span>,
    },
    {
      key: "flags",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          {row.remindersOptedOut && <Badge tone="muted">No reminders</Badge>}
          {row.isArchived && <Badge tone="warning">Archived</Badge>}
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              setEditing(row);
              setFormOpen(true);
            }}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              archive.mutate({ id: row.id, archived: !row.isArchived });
            }}
          >
            {row.isArchived ? "Restore" : "Archive"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Clients</h1>
          <p className="text-sm text-slate-500">
            {clients.data ? `${count(clients.data.total)} in the book` : "Loading"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            icon={<Download className="size-4" />}
            loading={exportRows.isPending}
            onClick={() => exportRows.mutate()}
          >
            Export
          </Button>
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
          >
            New client
          </Button>
        </div>
      </header>

      <Card bodyClassName="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Name, phone, email, code or PAN"
              className="pl-9"
            />
          </div>

          <Select
            className="w-40"
            value={filter.city ?? ""}
            onChange={(event) =>
              setFilter((current) => ({ ...current, city: event.target.value, page: 1 }))
            }
          >
            <option value="">All cities</option>
            {cities.data?.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </Select>

          <Select
            className="w-44"
            value={filter.category ?? ""}
            onChange={(event) =>
              setFilter((current) => ({ ...current, category: event.target.value, page: 1 }))
            }
          >
            <option value="">Any policy type</option>
            {categories.data?.map((option) => (
              <option key={option.secondary} value={option.secondary ?? ""}>
                Holds {option.label}
              </option>
            ))}
          </Select>

          <div className="flex flex-col gap-1.5 pb-0.5">
            <Checkbox
              label="Missing email"
              checked={filter.missingEmail ?? false}
              onChange={(value) =>
                setFilter((current) => ({ ...current, missingEmail: value, page: 1 }))
              }
            />
            <Checkbox
              label="Include archived"
              checked={filter.includeArchived ?? false}
              onChange={(value) =>
                setFilter((current) => ({ ...current, includeArchived: value, page: 1 }))
              }
            />
          </div>
        </div>
      </Card>

      <Card bodyClassName="">
        {clients.isLoading ? (
          <Spinner />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={clients.data?.rows ?? []}
              rowKey={(row) => row.id}
              sort={filter.sort}
              descending={filter.descending}
              onSort={(key) =>
                setFilter((current) => ({
                  ...current,
                  sort: key,
                  descending: current.sort === key ? !current.descending : false,
                }))
              }
              empty={
                <EmptyState
                  icon={<Users className="size-9" />}
                  title="No clients match"
                  description="Try clearing the filters, or add the client you were looking for."
                  action={
                    <Button
                      variant="primary"
                      icon={<UserPlus className="size-4" />}
                      onClick={() => {
                        setEditing(undefined);
                        setFormOpen(true);
                      }}
                    >
                      Add a client
                    </Button>
                  }
                />
              }
            />
            {clients.data && clients.data.total > 0 && (
              <Pagination
                page={clients.data.page}
                pageSize={clients.data.pageSize}
                total={clients.data.total}
                onPage={(page) => setFilter((current) => ({ ...current, page }))}
              />
            )}
          </>
        )}
      </Card>

      <ClientForm
        open={formOpen}
        client={editing}
        onClose={() => setFormOpen(false)}
      />
    </div>
  );
}
