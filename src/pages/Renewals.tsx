import { useMutation, useQuery } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { ClipboardCopy, Download, RefreshCcw } from "lucide-react";
import { useState } from "react";

import { api, ApiError } from "../lib/api";
import type { Policy, PolicyFilter } from "../lib/types";
import { count } from "../lib/format";
import { PolicyTable } from "../components/PolicyTable";
import { RenewModal } from "../components/RenewModal";
import { PolicyForm } from "../components/PolicyForm";
import { Button, Card, cx, useToast } from "../components/ui";

type TabId = "overdue" | "7" | "30" | "60" | "90";

/** The renewal desk works in windows, so the tabs are the windows. */
const TABS: Array<{ id: TabId; label: string; filter: PolicyFilter }> = [
  { id: "overdue", label: "Overdue", filter: { unrenewedOnly: true } },
  { id: "7", label: "Next 7 days", filter: { expiringWithinDays: 7, statuses: ["active"] } },
  { id: "30", label: "Next 30 days", filter: { expiringWithinDays: 30, statuses: ["active"] } },
  { id: "60", label: "Next 60 days", filter: { expiringWithinDays: 60, statuses: ["active"] } },
  { id: "90", label: "Next 90 days", filter: { expiringWithinDays: 90, statuses: ["active"] } },
];

export function RenewalsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<TabId>("30");
  const [sort, setSort] = useState<{ sort: string; descending: boolean }>({
    sort: "expiry",
    descending: false,
  });
  const [page, setPage] = useState(1);
  const [renewing, setRenewing] = useState<Policy | undefined>();
  const [editing, setEditing] = useState<Policy | undefined>();

  const active = TABS.find((entry) => entry.id === tab)!;
  const filter: PolicyFilter = {
    ...active.filter,
    ...sort,
    page,
    pageSize: 25,
  };

  const counts = useQuery({
    queryKey: ["renewalCounts"],
    queryFn: async () => {
      const results = await Promise.all(
        TABS.map((entry) => api.listPolicies({ ...entry.filter, pageSize: 1 })),
      );
      return Object.fromEntries(TABS.map((entry, index) => [entry.id, results[index].total])) as
        Record<string, number>;
    },
  });

  const refresh = useMutation({
    mutationFn: api.refreshStatuses,
    onSuccess: () => toast.success("Statuses recalculated against today's date"),
    onError: (err: ApiError) => toast.error(err.message),
  });

  /** Until automated reminders are switched on, this gets the list into a mail client. */
  const copyEmails = useMutation({
    mutationFn: async () => {
      const page = await api.listPolicies({ ...filter, page: 1, pageSize: 500 });
      const emails = Array.from(
        new Set(
          page.rows
            .filter((row) => row.clientEmail && !row.remindersOptedOut)
            .map((row) => row.clientEmail as string),
        ),
      );
      if (emails.length === 0) throw new ApiError("validation", "No email addresses in this list");
      await navigator.clipboard.writeText(emails.join(", "));
      return emails.length;
    },
    onSuccess: (total) => toast.success(`Copied ${count(total)} email addresses`),
    onError: (err: ApiError) => toast.error(err.message),
  });

  const exportRows = useMutation({
    mutationFn: async () => {
      const path = await save({
        title: "Export renewal list",
        defaultPath: `renewals-${active.id}.xlsx`,
        filters: [
          { name: "Excel", extensions: ["xlsx"] },
          { name: "CSV", extensions: ["csv"] },
        ],
      });
      if (!path) return 0;
      return api.exportPolicies(filter, path);
    },
    onSuccess: (rows) => rows > 0 && toast.success(`Exported ${count(rows)} rows`),
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Renewals</h1>
          <p className="text-sm text-slate-500">
            Work top down: the list is ordered by how soon cover stops.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            icon={<RefreshCcw className="size-4" />}
            loading={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            Recalculate
          </Button>
          <Button
            icon={<ClipboardCopy className="size-4" />}
            loading={copyEmails.isPending}
            onClick={() => copyEmails.mutate()}
          >
            Copy emails
          </Button>
          <Button
            icon={<Download className="size-4" />}
            loading={exportRows.isPending}
            onClick={() => exportRows.mutate()}
          >
            Export
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {TABS.map((entry) => {
          const total = counts.data?.[entry.id];
          const selected = entry.id === tab;
          return (
            <button
              key={entry.id}
              onClick={() => {
                setTab(entry.id);
                setPage(1);
              }}
              className={cx(
                "rounded-lg border px-3.5 py-2 text-sm transition",
                selected
                  ? "border-brand-500 bg-brand-50 font-medium text-brand-800"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              {entry.label}
              {total !== undefined && (
                <span
                  className={cx(
                    "ml-2 rounded px-1.5 py-0.5 text-xs",
                    entry.id === "overdue" && total > 0
                      ? "bg-rose-100 text-rose-700"
                      : "bg-slate-100 text-slate-500",
                  )}
                >
                  {total}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Card bodyClassName="">
        <PolicyTable
          filter={filter}
          onFilterChange={(next) => {
            setSort({ sort: next.sort ?? "expiry", descending: next.descending ?? false });
            setPage(next.page ?? 1);
          }}
          onEdit={setEditing}
          onRenew={setRenewing}
          emptyTitle={
            tab === "overdue" ? "Nothing has lapsed" : `Nothing expires in this window`
          }
          emptyDescription={
            tab === "overdue"
              ? "Every expired policy has been renewed or closed off."
              : "Check a wider window, or enjoy the quiet."
          }
        />
      </Card>

      <RenewModal policy={renewing} onClose={() => setRenewing(undefined)} />
      <PolicyForm
        open={Boolean(editing)}
        policy={editing}
        onClose={() => setEditing(undefined)}
      />
    </div>
  );
}
