import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api, ApiError } from "../lib/api";
import type { Insurer, InsurerInput, Product, ProductInput } from "../lib/types";
import { categoryLabel, categoryLabels, count } from "../lib/format";
import { DataTable, type Column } from "../components/DataTable";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  useToast,
} from "../components/ui";

export function InsurersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [showInactive, setShowInactive] = useState(false);
  const [insurerDraft, setInsurerDraft] = useState<Insurer | "new">();
  const [productDraft, setProductDraft] = useState<Product | "new">();
  const [selectedInsurer, setSelectedInsurer] = useState<number>();

  const insurers = useQuery({
    queryKey: ["insurers", showInactive],
    queryFn: () => api.listInsurers(showInactive),
  });
  const products = useQuery({
    queryKey: ["allProducts", selectedInsurer, showInactive],
    queryFn: () => api.listProducts(selectedInsurer, showInactive),
  });

  const removeInsurer = useMutation({
    mutationFn: (id: number) => api.deleteInsurer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurers"] });
      toast.success("Insurer removed");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const removeProduct = useMutation({
    mutationFn: (id: number) => api.deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allProducts"] });
      toast.success("Plan removed");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const insurerColumns: Column<Insurer>[] = [
    {
      key: "name",
      header: "Insurer",
      render: (row) => (
        <span className="block">
          <span className="block font-medium text-slate-800">{row.name}</span>
          <span className="block text-xs text-slate-400">
            {row.shortCode ?? "—"}
            {row.claimHelpline ? ` · claims ${row.claimHelpline}` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "policies",
      header: "Policies",
      align: "center",
      render: (row) => <span className="text-sm text-slate-700">{count(row.policyCount)}</span>,
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (row) => (
        <Badge tone={row.isActive ? "ok" : "muted"}>{row.isActive ? "Active" : "Inactive"}</Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedInsurer(row.id);
            }}
          >
            Plans
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              setInsurerDraft(row);
            }}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              if (window.confirm(`Remove ${row.name}?`)) removeInsurer.mutate(row.id);
            }}
          >
            <Trash2 className="size-3.5 text-slate-400" />
          </Button>
        </div>
      ),
    },
  ];

  const productColumns: Column<Product>[] = [
    {
      key: "name",
      header: "Plan",
      render: (row) => (
        <span className="block">
          <span className="block font-medium text-slate-800">{row.name}</span>
          <span className="block text-xs text-slate-400">{row.insurerName}</span>
        </span>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (row) => <span className="text-sm text-slate-600">{categoryLabel(row.category)}</span>,
    },
    {
      key: "policies",
      header: "Policies",
      align: "center",
      render: (row) => <span className="text-sm text-slate-700">{count(row.policyCount)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setProductDraft(row)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (window.confirm(`Remove ${row.name}?`)) removeProduct.mutate(row.id);
            }}
          >
            <Trash2 className="size-3.5 text-slate-400" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Insurers & plans</h1>
          <p className="text-sm text-slate-500">
            Common Indian insurers are pre-loaded. Deactivate the ones you do not deal with to keep
            the pickers short.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Checkbox label="Show inactive" checked={showInactive} onChange={setShowInactive} />
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            onClick={() => setInsurerDraft("new")}
          >
            New insurer
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Insurers" bodyClassName="">
          {insurers.isLoading ? (
            <Spinner />
          ) : (
            <DataTable
              columns={insurerColumns}
              rows={insurers.data ?? []}
              rowKey={(row) => row.id}
              dense
              empty={
                <EmptyState
                  icon={<Building2 className="size-9" />}
                  title="No insurers"
                  description="Add the companies you place business with."
                />
              }
            />
          )}
        </Card>

        <Card
          title={
            selectedInsurer
              ? `Plans — ${insurers.data?.find((i) => i.id === selectedInsurer)?.name ?? ""}`
              : "All plans"
          }
          action={
            <div className="flex items-center gap-1">
              {selectedInsurer && (
                <Button size="sm" variant="ghost" onClick={() => setSelectedInsurer(undefined)}>
                  Show all
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus className="size-3.5" />}
                onClick={() => setProductDraft("new")}
              >
                Add
              </Button>
            </div>
          }
          bodyClassName=""
        >
          {products.isLoading ? (
            <Spinner />
          ) : (
            <DataTable
              columns={productColumns}
              rows={products.data ?? []}
              rowKey={(row) => row.id}
              dense
              empty={
                <EmptyState
                  title="No plans recorded"
                  description="Plans are optional — they are created automatically when you import a file that names them."
                />
              }
            />
          )}
        </Card>
      </div>

      <InsurerModal draft={insurerDraft} onClose={() => setInsurerDraft(undefined)} />
      <ProductModal
        draft={productDraft}
        insurers={insurers.data ?? []}
        defaultInsurerId={selectedInsurer}
        onClose={() => setProductDraft(undefined)}
      />
    </div>
  );
}

function InsurerModal({ draft, onClose }: { draft?: Insurer | "new"; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const existing = draft && draft !== "new" ? draft : undefined;
  const [form, setForm] = useState<InsurerInput>({ name: "", isActive: true });
  const [seeded, setSeeded] = useState<string | number>();

  const key = existing?.id ?? "new";
  if (draft && seeded !== key) {
    setSeeded(key);
    setForm({
      name: existing?.name ?? "",
      shortCode: existing?.shortCode ?? "",
      website: existing?.website ?? "",
      claimHelpline: existing?.claimHelpline ?? "",
      supportEmail: existing?.supportEmail ?? "",
      notes: existing?.notes ?? "",
      isActive: existing?.isActive ?? true,
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      if (existing) await api.updateInsurer(existing.id, form);
      else await api.createInsurer(form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurers"] });
      queryClient.invalidateQueries({ queryKey: ["insurerOptions"] });
      toast.success(existing ? "Insurer updated" : "Insurer added");
      onClose();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (!draft) return null;

  return (
    <Modal
      open
      onClose={onClose}
      width="sm"
      title={existing ? `Edit ${existing.name}` : "New insurer"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required>
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            autoFocus
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Short code">
            <Input
              value={form.shortCode ?? ""}
              onChange={(event) => setForm({ ...form, shortCode: event.target.value })}
            />
          </Field>
          <Field label="Claims helpline">
            <Input
              value={form.claimHelpline ?? ""}
              onChange={(event) => setForm({ ...form, claimHelpline: event.target.value })}
            />
          </Field>
        </div>
        <Field label="Support email">
          <Input
            value={form.supportEmail ?? ""}
            onChange={(event) => setForm({ ...form, supportEmail: event.target.value })}
          />
        </Field>
        <Field label="Website">
          <Input
            value={form.website ?? ""}
            onChange={(event) => setForm({ ...form, website: event.target.value })}
          />
        </Field>
        <Checkbox
          label="Active"
          hint="Inactive insurers stay on old policies but drop out of the pickers"
          checked={form.isActive ?? true}
          onChange={(value) => setForm({ ...form, isActive: value })}
        />
      </div>
    </Modal>
  );
}

function ProductModal({
  draft,
  insurers,
  defaultInsurerId,
  onClose,
}: {
  draft?: Product | "new";
  insurers: Insurer[];
  defaultInsurerId?: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const existing = draft && draft !== "new" ? draft : undefined;
  const [form, setForm] = useState<ProductInput>({
    insurerId: 0,
    name: "",
    category: "health",
    isActive: true,
  });
  const [seeded, setSeeded] = useState<string | number>();

  const key = existing?.id ?? "new";
  if (draft && seeded !== key) {
    setSeeded(key);
    setForm({
      insurerId: existing?.insurerId ?? defaultInsurerId ?? insurers[0]?.id ?? 0,
      name: existing?.name ?? "",
      category: existing?.category ?? "health",
      code: existing?.code ?? "",
      notes: existing?.notes ?? "",
      isActive: existing?.isActive ?? true,
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      if (existing) await api.updateProduct(existing.id, form);
      else await api.createProduct(form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allProducts"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(existing ? "Plan updated" : "Plan added");
      onClose();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (!draft) return null;

  return (
    <Modal
      open
      onClose={onClose}
      width="sm"
      title={existing ? `Edit ${existing.name}` : "New plan"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Insurer" required>
          <Select
            value={form.insurerId || ""}
            onChange={(event) => setForm({ ...form, insurerId: Number(event.target.value) })}
          >
            <option value="">Choose an insurer</option>
            {insurers.map((insurer) => (
              <option key={insurer.id} value={insurer.id}>
                {insurer.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Plan name" required>
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Family Health Optima"
          />
        </Field>
        <Field label="Category" required>
          <Select
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
          >
            {Object.entries(categoryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Plan code">
          <Input
            value={form.code ?? ""}
            onChange={(event) => setForm({ ...form, code: event.target.value })}
          />
        </Field>
        <Checkbox
          label="Active"
          checked={form.isActive ?? true}
          onChange={(value) => setForm({ ...form, isActive: value })}
        />
      </div>
    </Modal>
  );
}
