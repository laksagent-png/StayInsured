import { useMutation, useQuery } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import type { Policy, PolicyFilter } from "../lib/types";
import { categoryLabels, count, date, money } from "../lib/format";
import { PolicyForm } from "../components/PolicyForm";
import { PolicyTable } from "../components/PolicyTable";
import { RenewModal } from "../components/RenewModal";
import { Badge, Button, Card, Checkbox, Input, Modal, Select, useToast } from "../components/ui";

export function PoliciesPage() {
  const [params] = useSearchParams();
  const toast = useToast();

  const [filter, setFilter] = useState<PolicyFilter>(() => ({
    page: 1,
    pageSize: 25,
    sort: "expiry",
    search: params.get("q") ?? undefined,
    ...(params.get("view") === "lapsed" ? { unrenewedOnly: true } : {}),
  }));
  const [searchText, setSearchText] = useState(params.get("q") ?? "");
  const [editing, setEditing] = useState<Policy | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [renewing, setRenewing] = useState<Policy | undefined>();
  const [history, setHistory] = useState<Policy | undefined>();

  useEffect(() => {
    const timer = window.setTimeout(
      () => setFilter((current) => ({ ...current, search: searchText, page: 1 })),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const insurers = useQuery({ queryKey: ["insurerOptions"], queryFn: api.insurerOptions });

  const exportRows = useMutation({
    mutationFn: async () => {
      const path = await save({
        title: "Export policies",
        defaultPath: "policies.xlsx",
        filters: [
          { name: "Excel", extensions: ["xlsx"] },
          { name: "CSV", extensions: ["csv"] },
        ],
      });
      if (!path) return 0;
      return api.exportPolicies(filter, path);
    },
    onSuccess: (rows) => rows > 0 && toast.success(`Exported ${count(rows)} policies`),
    onError: (err: ApiError) => toast.error(err.message),
  });

  const update = (patch: Partial<PolicyFilter>) =>
    setFilter((current) => ({ ...current, ...patch, page: 1 }));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Policies</h1>
          <p className="text-sm text-slate-500">
            Every policy year is kept, so history stays intact after a renewal.
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
            New policy
          </Button>
        </div>
      </header>

      <Card bodyClassName="p-3">
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
              <Input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Policy number, client, vehicle"
                className="pl-9"
              />
            </div>

            <Select
              className="w-44"
              value={filter.categories?.[0] ?? ""}
              onChange={(event) =>
                update({ categories: event.target.value ? [event.target.value] : undefined })
              }
            >
              <option value="">All categories</option>
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>

            <Select
              className="w-40"
              value={filter.statuses?.[0] ?? ""}
              onChange={(event) =>
                update({ statuses: event.target.value ? [event.target.value] : undefined })
              }
            >
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="lapsed">Lapsed</option>
              <option value="renewed">Renewed</option>
              <option value="cancelled">Cancelled</option>
            </Select>

            <Select
              className="w-52"
              value={filter.insurerId ?? ""}
              onChange={(event) =>
                update({ insurerId: event.target.value ? Number(event.target.value) : undefined })
              }
            >
              <option value="">All insurers</option>
              {insurers.data?.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Expiry between</span>
              <Input
                type="date"
                className="w-36"
                value={filter.expiryFrom ?? ""}
                onChange={(event) => update({ expiryFrom: event.target.value || undefined })}
              />
              <span>and</span>
              <Input
                type="date"
                className="w-36"
                value={filter.expiryTo ?? ""}
                onChange={(event) => update({ expiryTo: event.target.value || undefined })}
              />
            </div>

            <Checkbox
              label="Latest year only"
              checked={filter.latestOnly ?? false}
              onChange={(value) => update({ latestOnly: value })}
            />
            <Checkbox
              label="Expired and never renewed"
              checked={filter.unrenewedOnly ?? false}
              onChange={(value) => update({ unrenewedOnly: value })}
            />

            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                setSearchText("");
                setFilter({ page: 1, pageSize: 25, sort: "expiry" });
              }}
            >
              Clear filters
            </Button>
          </div>
        </div>
      </Card>

      <Card bodyClassName="">
        <PolicyTable
          filter={filter}
          onFilterChange={setFilter}
          onEdit={(policy) => {
            setEditing(policy);
            setFormOpen(true);
          }}
          onRenew={setRenewing}
          onHistory={setHistory}
        />
      </Card>

      <PolicyForm open={formOpen} policy={editing} onClose={() => setFormOpen(false)} />
      <RenewModal policy={renewing} onClose={() => setRenewing(undefined)} />
      <ChainModal policy={history} onClose={() => setHistory(undefined)} />
    </div>
  );
}

function ChainModal({ policy, onClose }: { policy?: Policy; onClose: () => void }) {
  const chain = useQuery({
    queryKey: ["chain", policy?.id],
    queryFn: () => api.policyChain(policy!.id),
    enabled: Boolean(policy),
  });

  if (!policy) return null;

  return (
    <Modal
      open
      onClose={onClose}
      width="md"
      title={`${policy.clientName} — policy history`}
      description="Each row is one policy year of the same underlying cover."
    >
      <ol className="relative space-y-4 border-l border-slate-200 pl-5">
        {chain.data?.map((year) => (
          <li key={year.id} className="relative">
            <span
              className={[
                "absolute top-1.5 -left-[26px] size-3 rounded-full ring-4 ring-white",
                year.id === policy.id ? "bg-brand-600" : "bg-slate-300",
              ].join(" ")}
            />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-700">
                  Year {year.policyYear} · {year.policyNumber}
                </p>
                <p className="text-xs text-slate-500">
                  {date(year.startDate)} → {date(year.expiryDate)} · {year.insurerName}
                </p>
                {year.notes && <p className="mt-1 text-xs text-slate-400">{year.notes}</p>}
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-700">{money(year.premiumAmount)}</p>
                <p className="text-xs text-slate-400">{money(year.sumInsured)} cover</p>
                <Badge tone={year.status === "active" ? "ok" : "muted"}>{year.status}</Badge>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Modal>
  );
}
