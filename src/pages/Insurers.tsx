import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api, ApiError } from "../lib/api";
import type { Insurer, InsurerInput, Product, ProductInput } from "../lib/types";
import { categoryLabel, categoryLabels, count } from "../lib/format";
import { DataTable, type Column } from "../components/DataTable";
import {
  AsyncPanel,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  useToast,
} from "../components/ui";

/**
 * The insurer the plans panel is filtered to, carried with its name: retiring a
 * company takes it out of the list the heading would otherwise be read from,
 * and the plans below the heading are still that company's.
 */
interface Chosen {
  id: number;
  name: string;
}

/** An optional field left empty belongs in the book as nothing, not as "". */
function blankToNone(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function InsurersPage() {
  const toast = useToast();

  const [showInactive, setShowInactive] = useState(false);
  const [insurerDraft, setInsurerDraft] = useState<Insurer | "new">();
  const [productDraft, setProductDraft] = useState<Product | "new">();
  const [chosen, setChosen] = useState<Chosen>();

  const insurers = useQuery({
    queryKey: ["insurers", showInactive],
    queryFn: () => api.listInsurers(showInactive),
  });
  const products = useQuery({
    queryKey: ["allProducts", chosen?.id, showInactive],
    queryFn: () => api.listProducts(chosen?.id, showInactive),
  });

  const removeInsurer = useMutation({
    mutationFn: (id: number) => api.deleteInsurer(id),
    onSuccess: (_result, id) => {
      // A filter on a company that is no longer in the book leaves the panel
      // headed by a dash with nothing after it.
      if (chosen?.id === id) setChosen(undefined);
      toast.success("Insurer removed");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const removeProduct = useMutation({
    mutationFn: (id: number) => api.deleteProduct(id),
    onSuccess: () => {
      toast.success("Plan removed");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  /**
   * The company a plan belongs to. The insurer list holds the name as it reads
   * today, so the two panels agree the moment one is renamed; the copy the plan
   * carries answers for a company the list does not hold.
   */
  const insurerOf = (row: Product): string =>
    insurers.data?.find((insurer) => insurer.id === row.insurerId)?.name ?? row.insurerName;

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
          {(row.supportEmail || row.website) && (
            <span className="block text-xs text-slate-400">
              {[row.supportEmail, row.website].filter(Boolean).join(" · ")}
            </span>
          )}
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
              setChosen({ id: row.id, name: row.name });
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
            aria-label={`Remove ${row.name}`}
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
          <span className="block text-xs text-slate-400">{insurerOf(row)}</span>
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
          <Button size="sm" variant="ghost" onClick={() => setProductDraft(row)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remove ${row.name}`}
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
          <AsyncPanel query={insurers} errorTitle="The insurers could not be read">
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
          </AsyncPanel>
        </Card>

        <Card
          title={chosen ? `Plans — ${chosen.name}` : "All plans"}
          action={
            <div className="flex items-center gap-1">
              {chosen && (
                <Button size="sm" variant="ghost" onClick={() => setChosen(undefined)}>
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
          <AsyncPanel query={products} errorTitle="The plans could not be read">
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
          </AsyncPanel>
        </Card>
      </div>

      {/* Both dialogs are mounted when they open and thrown away when they
          close, so what was typed and abandoned is not there the next time. */}
      {insurerDraft && (
        <InsurerModal draft={insurerDraft} onClose={() => setInsurerDraft(undefined)} />
      )}
      {productDraft && (
        <ProductModal
          draft={productDraft}
          insurers={insurers.data ?? []}
          defaultInsurerId={chosen?.id}
          onClose={() => setProductDraft(undefined)}
        />
      )}
    </div>
  );
}

function InsurerModal({ draft, onClose }: { draft: Insurer | "new"; onClose: () => void }) {
  const toast = useToast();
  const existing = draft === "new" ? undefined : draft;
  const [form, setForm] = useState<InsurerInput>(() => ({
    name: existing?.name ?? "",
    shortCode: existing?.shortCode ?? "",
    website: existing?.website ?? "",
    claimHelpline: existing?.claimHelpline ?? "",
    supportEmail: existing?.supportEmail ?? "",
    notes: existing?.notes ?? "",
    isActive: existing?.isActive ?? true,
  }));

  const save = useMutation({
    mutationFn: async () => {
      const input: InsurerInput = {
        ...form,
        shortCode: blankToNone(form.shortCode),
        website: blankToNone(form.website),
        claimHelpline: blankToNone(form.claimHelpline),
        supportEmail: blankToNone(form.supportEmail),
        notes: blankToNone(form.notes),
      };
      if (existing) await api.updateInsurer(existing.id, input);
      else await api.createInsurer(input);
    },
    onSuccess: () => {
      toast.success(existing ? "Insurer updated" : "Insurer added");
      onClose();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

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
  draft: Product | "new";
  insurers: Insurer[];
  defaultInsurerId?: number;
  onClose: () => void;
}) {
  const toast = useToast();
  const existing = draft === "new" ? undefined : draft;
  const [form, setForm] = useState<ProductInput>(() => ({
    insurerId: existing?.insurerId ?? defaultInsurerId ?? insurers[0]?.id ?? 0,
    name: existing?.name ?? "",
    category: existing?.category ?? "health",
    code: existing?.code ?? "",
    notes: existing?.notes ?? "",
    isActive: existing?.isActive ?? true,
  }));
  const [insurerError, setInsurerError] = useState<string>();

  // A plan can belong to a company that has been retired, and the picker has to
  // go on naming it rather than opening on nothing.
  const options: { id: number; name: string }[] = [...insurers];
  if (existing && !options.some((option) => option.id === existing.insurerId)) {
    options.push({ id: existing.insurerId, name: existing.insurerName });
  }

  const save = useMutation({
    mutationFn: async () => {
      const input: ProductInput = {
        ...form,
        code: blankToNone(form.code),
        notes: blankToNone(form.notes),
      };
      if (existing) await api.updateProduct(existing.id, input);
      else await api.createProduct(input);
    },
    onSuccess: () => {
      toast.success(existing ? "Plan updated" : "Plan added");
      onClose();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  // The book refuses a plan that belongs to nobody, so the form says so here
  // rather than sending it and reporting a foreign key back.
  const submit = () => {
    if (!form.insurerId) {
      setInsurerError("Choose the insurer this plan belongs to");
      return;
    }
    save.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="sm"
      title={existing ? `Edit ${existing.name}` : "New plan"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Insurer" required error={insurerError}>
          <Select
            value={form.insurerId || ""}
            onChange={(event) => {
              setInsurerError(undefined);
              setForm({ ...form, insurerId: Number(event.target.value) });
            }}
          >
            <option value="">Choose an insurer</option>
            {options.map((insurer) => (
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
