import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { api, ApiError } from "../lib/api";
import type { Policy, PolicyInput, PolicyStatus } from "../lib/types";
import { categoryLabels, date, money, relationshipLabel, statusLabels } from "../lib/format";
import { Badge, Button, Field, Input, Modal, Select, Textarea, useToast } from "./ui";

/** Adds a year minus a day, which is what an annual policy term means in practice. */
function defaultExpiry(start: string): string {
  if (!start) return "";
  const [year, month, day] = start.split("-").map(Number);
  if (!year || !month || !day) return "";
  const next = new Date(Date.UTC(year + 1, month - 1, day));
  next.setUTCDate(next.getUTCDate() - 1);
  return next.toISOString().slice(0, 10);
}

/** What the rate comes to on the premium, which is what the form suggests. */
function commissionFrom(
  premium: number | null | undefined,
  rate: number | null | undefined,
): number | null {
  if (!premium || !rate) return null;
  return Math.round((premium * rate) / 100);
}

/**
 * The statuses an agent owns. The others follow from the dates and the chain,
 * so the core works them out and the form leaves them alone.
 */
const CHOOSABLE_STATUSES: PolicyStatus[] = ["active", "cancelled"];

function isNegative(value: number | null | undefined): boolean {
  return value != null && value < 0;
}

const EMPTY: PolicyInput = {
  policyNumber: "",
  clientId: 0,
  insurerId: 0,
  productId: null,
  category: "health",
  startDate: "",
  expiryDate: "",
  sumInsured: null,
  premiumAmount: null,
  gstAmount: null,
  premiumFrequency: "annual",
  paymentMode: "",
  commissionRate: null,
  commissionExpected: null,
  nomineeName: "",
  nomineeRelation: "",
  vehicleNumber: "",
  notes: "",
  insuredClientIds: [],
};

export function PolicyForm({
  open,
  onClose,
  policy,
  fixedClientId,
}: {
  open: boolean;
  onClose: () => void;
  policy?: Policy;
  fixedClientId?: number;
}) {
  const toast = useToast();
  const [form, setForm] = useState<PolicyInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  // Null while the box is showing the chosen client rather than a search.
  const [clientSearch, setClientSearch] = useState<string | null>(null);
  const [showClientList, setShowClientList] = useState(false);

  const insurers = useQuery({ queryKey: ["insurerOptions"], queryFn: api.insurerOptions });
  const products = useQuery({
    queryKey: ["products", form.insurerId],
    queryFn: () => api.listProducts(form.insurerId),
    enabled: form.insurerId > 0,
  });
  const clientResults = useQuery({
    queryKey: ["clientPicker", clientSearch ?? ""],
    queryFn: () => api.listClients({ search: clientSearch ?? "", pageSize: 8, sort: "name" }),
    enabled: showClientList,
  });
  const selectedClient = useQuery({
    queryKey: ["client", form.clientId],
    queryFn: () => api.getClient(form.clientId),
    enabled: form.clientId > 0,
  });
  const relatives = useQuery({
    queryKey: ["relatives", form.clientId],
    queryFn: () => api.listRelatives(form.clientId),
    enabled: form.clientId > 0,
  });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setClientSearch(null);
    setShowClientList(false);

    if (policy) {
      setForm({
        policyNumber: policy.policyNumber,
        clientId: policy.clientId,
        insurerId: policy.insurerId,
        productId: policy.productId,
        category: policy.category,
        status: policy.status,
        startDate: policy.startDate,
        expiryDate: policy.expiryDate,
        sumInsured: policy.sumInsured,
        premiumAmount: policy.premiumAmount,
        gstAmount: policy.gstAmount,
        premiumFrequency: policy.premiumFrequency,
        paymentMode: policy.paymentMode ?? "",
        commissionRate: policy.commissionRate,
        // An amount that matches the rate was worked out rather than typed, so
        // it is left to keep following the premium.
        commissionExpected:
          policy.commissionExpected === commissionFrom(policy.premiumAmount, policy.commissionRate)
            ? null
            : policy.commissionExpected,
        nomineeName: policy.nomineeName ?? "",
        nomineeRelation: policy.nomineeRelation ?? "",
        vehicleNumber: policy.vehicleNumber ?? "",
        notes: policy.notes ?? "",
        insuredClientIds: [],
      });
      api.policyInsuredIds(policy.id).then((ids) =>
        setForm((current) => ({ ...current, insuredClientIds: ids })),
      );
    } else {
      const today = new Date().toISOString().slice(0, 10);
      setForm({
        ...EMPTY,
        clientId: fixedClientId ?? 0,
        startDate: today,
        expiryDate: defaultExpiry(today),
      });
    }
  }, [open, policy, fixedClientId]);

  const set = <K extends keyof PolicyInput>(key: K, value: PolicyInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  // Commission amount follows the rate unless it has been typed in directly.
  const suggestedCommission = useMemo(
    () => commissionFrom(form.premiumAmount, form.commissionRate),
    [form.premiumAmount, form.commissionRate],
  );

  const save = useMutation({
    mutationFn: async () => {
      const payload: PolicyInput = {
        ...form,
        commissionExpected: form.commissionExpected ?? suggestedCommission,
        // A registration number belongs to motor cover; any other category
        // leaves it behind rather than carrying it along unseen.
        vehicleNumber: form.category === "motor" ? form.vehicleNumber : "",
      };
      if (policy) {
        await api.updatePolicy(policy.id, payload);
        return policy.id;
      }
      return api.createPolicy(payload);
    },
    onSuccess: () => {
      toast.success(policy ? "Policy updated" : "Policy added");
      onClose();
    },
    onError: (err: ApiError) => setError(err.message),
  });

  /** Taking a client on: only the holder and their relatives may be covered, so
   * another client starts with nobody named. */
  const chooseClient = (id: number) => {
    setForm((current) => ({ ...current, clientId: id, insuredClientIds: [] }));
    setShowClientList(false);
    setClientSearch(null);
  };

  const validate = () => {
    if (!form.clientId) return "Choose the client this policy belongs to";
    if (!form.insurerId) return "Choose the insurer";
    if (!form.policyNumber.trim()) return "Policy number is required";
    if (!form.startDate || !form.expiryDate) return "Both start and expiry dates are needed";
    // Both dates are ISO, so they compare as they read.
    if (form.expiryDate < form.startDate) return "The expiry date must come after the start date";
    if (isNegative(form.sumInsured)) return "The sum insured cannot be less than nothing";
    if (isNegative(form.premiumAmount)) return "The premium cannot be less than nothing";
    if (isNegative(form.gstAmount)) return "The GST cannot be less than nothing";
    if (isNegative(form.commissionExpected)) return "The commission cannot be less than nothing";
    if (form.commissionRate != null && (form.commissionRate < 0 || form.commissionRate > 100)) {
      return "The commission rate is a share of the premium, so it lies between 0 and 100";
    }
    return null;
  };

  const submit = () => {
    // A second Enter while the core is writing would send the policy twice.
    if (save.isPending) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    save.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="xl"
      title={policy ? `Edit policy ${policy.policyNumber}` : "New policy"}
      description={
        policy
          ? "Editing changes this policy year only. Use Renew to add the next year."
          : "Record the current policy year; renewals are added on top of it later."
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {policy ? "Save changes" : "Add policy"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field label="Client" required>
              {fixedClientId || policy ? (
                <Input
                  disabled
                  value={selectedClient.data?.fullName ?? "Loading…"}
                />
              ) : (
                <div
                  className="relative"
                  // The list closes as soon as the work moves past it, but not
                  // while the focus is on its way to one of its own rows.
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setShowClientList(false);
                    }
                  }}
                >
                  <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
                  <Input
                    className="pl-9"
                    placeholder="Search by name, phone or code"
                    value={clientSearch ?? selectedClient.data?.fullName ?? ""}
                    onChange={(event) => {
                      setClientSearch(event.target.value);
                      setShowClientList(true);
                    }}
                    onFocus={(event) => {
                      setShowClientList(true);
                      // The chosen name is on show, so typing replaces it.
                      event.currentTarget.select();
                    }}
                    // Enter here belongs to the list underneath: it takes the
                    // closest match rather than saving a policy that has no
                    // client on it yet.
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      const closest = clientResults.data?.rows[0];
                      if (showClientList && closest) chooseClient(closest.id);
                    }}
                  />
                  {showClientList && (clientResults.data?.rows.length ?? 0) > 0 && (
                    <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                      {clientResults.data?.rows.map((client) => (
                        <li key={client.id}>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50"
                            onClick={() => chooseClient(client.id)}
                          >
                            <span>
                              <span className="block font-medium text-slate-700">
                                {client.fullName}
                              </span>
                              <span className="block text-xs text-slate-400">
                                {client.clientCode}
                                {client.phone ? ` · ${client.phone}` : ""}
                              </span>
                            </span>
                            <Badge tone="muted">{client.activePolicies} active</Badge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Field>
          </div>

          <Field label="Policy number" required>
            <Input
              value={form.policyNumber}
              onChange={(event) => set("policyNumber", event.target.value)}
              placeholder="HS/2026/0091823"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Insurer" required>
            <Select
              value={form.insurerId || ""}
              onChange={(event) => {
                set("insurerId", Number(event.target.value));
                set("productId", null);
              }}
            >
              <option value="">Choose an insurer</option>
              {insurers.data?.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Plan" hint={form.insurerId ? undefined : "Pick an insurer first"}>
            <Select
              value={form.productId ?? ""}
              disabled={!form.insurerId}
              onChange={(event) =>
                set("productId", event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">Not recorded</option>
              {products.data?.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Category" required>
            <Select value={form.category} onChange={(event) => set("category", event.target.value)}>
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Start date" required>
            <Input
              type="date"
              value={form.startDate}
              onChange={(event) => {
                const value = event.target.value;
                setForm((current) => ({
                  ...current,
                  startDate: value,
                  // Only auto-fill while the expiry has not been set by hand.
                  expiryDate:
                    !current.expiryDate || current.expiryDate === defaultExpiry(current.startDate)
                      ? defaultExpiry(value)
                      : current.expiryDate,
                }));
              }}
            />
          </Field>
          <Field label="Expiry date" required>
            <Input
              type="date"
              value={form.expiryDate}
              onChange={(event) => set("expiryDate", event.target.value)}
            />
          </Field>
          <Field label="Sum insured">
            <Input
              type="number"
              value={form.sumInsured ?? ""}
              onChange={(event) =>
                set("sumInsured", event.target.value ? Number(event.target.value) : null)
              }
              placeholder="1000000"
            />
          </Field>
          <Field label="Premium">
            <Input
              type="number"
              value={form.premiumAmount ?? ""}
              onChange={(event) =>
                set("premiumAmount", event.target.value ? Number(event.target.value) : null)
              }
              placeholder="24500"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="GST">
            <Input
              type="number"
              value={form.gstAmount ?? ""}
              onChange={(event) =>
                set("gstAmount", event.target.value ? Number(event.target.value) : null)
              }
            />
          </Field>
          <Field label="Frequency">
            <Select
              value={form.premiumFrequency ?? "annual"}
              onChange={(event) => set("premiumFrequency", event.target.value)}
            >
              <option value="annual">Annual</option>
              <option value="half_yearly">Half yearly</option>
              <option value="quarterly">Quarterly</option>
              <option value="monthly">Monthly</option>
              <option value="single">Single premium</option>
            </Select>
          </Field>
          <Field label="Commission %">
            <Input
              type="number"
              step="0.01"
              value={form.commissionRate ?? ""}
              onChange={(event) =>
                set("commissionRate", event.target.value ? Number(event.target.value) : null)
              }
            />
          </Field>
          <Field
            label="Commission amount"
            hint={
              suggestedCommission && form.commissionExpected === null
                ? `${money(suggestedCommission)} from the rate`
                : undefined
            }
          >
            <Input
              type="number"
              value={form.commissionExpected ?? ""}
              placeholder={suggestedCommission ? String(suggestedCommission) : ""}
              onChange={(event) =>
                set("commissionExpected", event.target.value ? Number(event.target.value) : null)
              }
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Payment mode">
            <Input
              value={form.paymentMode ?? ""}
              onChange={(event) => set("paymentMode", event.target.value)}
              placeholder="UPI, cheque, card"
            />
          </Field>
          <Field label="Nominee">
            <Input
              value={form.nomineeName ?? ""}
              onChange={(event) => set("nomineeName", event.target.value)}
            />
          </Field>
          <Field label="Nominee relation">
            <Input
              value={form.nomineeRelation ?? ""}
              onChange={(event) => set("nomineeRelation", event.target.value)}
            />
          </Field>
          {form.category === "motor" && (
            <Field label="Vehicle number">
              <Input
                value={form.vehicleNumber ?? ""}
                onChange={(event) => set("vehicleNumber", event.target.value.toUpperCase())}
                placeholder="MH12AB1234"
              />
            </Field>
          )}
        </div>

        {/* The lives a floater covers are clients: the holder, and the people
            related to them. A client with nobody linked gets no list, because
            naming the holder on their own motor policy says nothing. */}
        {(relatives.data?.length ?? 0) > 0 && (
          <div>
            <span className="field-label">Members covered</span>
            <div className="flex flex-wrap gap-2">
              {[
                {
                  id: form.clientId,
                  fullName: selectedClient.data?.fullName ?? "Policyholder",
                  relation: "policyholder",
                },
                ...(relatives.data ?? []).map((relative) => ({
                  id: relative.clientId,
                  fullName: relative.fullName,
                  relation: relationshipLabel(relative.relationship, relative.outgoing).toLowerCase(),
                })),
              ].map((person) => {
                const selected = form.insuredClientIds?.includes(person.id) ?? false;
                return (
                  <button
                    key={person.id}
                    type="button"
                    // The relationship is set apart by a margin on screen, which
                    // a screen reader runs into the name.
                    aria-label={`${person.fullName}, ${person.relation}`}
                    onClick={() =>
                      set(
                        "insuredClientIds",
                        selected
                          ? (form.insuredClientIds ?? []).filter((id) => id !== person.id)
                          : [...(form.insuredClientIds ?? []), person.id],
                      )
                    }
                    className={[
                      "rounded-full border px-3 py-1 text-xs transition",
                      selected
                        ? "border-brand-500 bg-brand-50 text-brand-800"
                        : "border-slate-300 text-slate-600 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    {person.fullName}
                    <span className="ml-1 text-slate-400">{person.relation}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {policy && (
          <div className="grid gap-4 sm:grid-cols-4">
            <Field
              label="Status"
              hint="Cancel a policy the client ended early; the rest follow the dates"
            >
              <Select
                value={form.status ?? policy.status}
                onChange={(event) => set("status", event.target.value)}
              >
                {!CHOOSABLE_STATUSES.includes(policy.status) && (
                  <option value={policy.status} disabled>
                    {statusLabels[policy.status]}
                  </option>
                )}
                {CHOOSABLE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        <Field label="Notes">
          <Textarea
            value={form.notes ?? ""}
            onChange={(event) => set("notes", event.target.value)}
          />
        </Field>

        {policy && (
          <p className="text-xs text-slate-400">
            Policy year {policy.policyYear} · created {date(policy.createdAt.slice(0, 10))}
          </p>
        )}

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        {/*
          Enter in a field submits through the form's own button, and the one
          the agent presses sits in the modal's footer, outside the form.
        */}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
