import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { api, ApiError } from "../lib/api";
import type { Policy, PolicyInput } from "../lib/types";
import { categoryLabels, date, money } from "../lib/format";
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
  memberIds: [],
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
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<PolicyInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientList, setShowClientList] = useState(false);

  const insurers = useQuery({ queryKey: ["insurerOptions"], queryFn: api.insurerOptions });
  const products = useQuery({
    queryKey: ["products", form.insurerId],
    queryFn: () => api.listProducts(form.insurerId),
    enabled: form.insurerId > 0,
  });
  const clientResults = useQuery({
    queryKey: ["clientPicker", clientSearch],
    queryFn: () => api.listClients({ search: clientSearch, pageSize: 8, sort: "name" }),
    enabled: showClientList,
  });
  const selectedClient = useQuery({
    queryKey: ["client", form.clientId],
    queryFn: () => api.getClient(form.clientId),
    enabled: form.clientId > 0,
  });
  const members = useQuery({
    queryKey: ["members", form.clientId],
    queryFn: () => api.listMembers(form.clientId),
    enabled: form.clientId > 0,
  });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setClientSearch("");
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
        commissionExpected: policy.commissionExpected,
        nomineeName: policy.nomineeName ?? "",
        nomineeRelation: policy.nomineeRelation ?? "",
        vehicleNumber: policy.vehicleNumber ?? "",
        notes: policy.notes ?? "",
        memberIds: [],
      });
      api.policyMemberIds(policy.id).then((ids) =>
        setForm((current) => ({ ...current, memberIds: ids })),
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
  const suggestedCommission = useMemo(() => {
    if (!form.premiumAmount || !form.commissionRate) return null;
    return Math.round((form.premiumAmount * form.commissionRate) / 100);
  }, [form.premiumAmount, form.commissionRate]);

  const save = useMutation({
    mutationFn: async () => {
      const payload: PolicyInput = {
        ...form,
        commissionExpected: form.commissionExpected ?? suggestedCommission,
      };
      if (policy) {
        await api.updatePolicy(policy.id, payload);
        return policy.id;
      }
      return api.createPolicy(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success(policy ? "Policy updated" : "Policy added");
      onClose();
    },
    onError: (err: ApiError) => setError(err.message),
  });

  const validate = () => {
    if (!form.clientId) return "Choose the client this policy belongs to";
    if (!form.insurerId) return "Choose the insurer";
    if (!form.policyNumber.trim()) return "Policy number is required";
    if (!form.startDate || !form.expiryDate) return "Both start and expiry dates are needed";
    return null;
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
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              const problem = validate();
              if (problem) {
                setError(problem);
                return;
              }
              save.mutate();
            }}
          >
            {policy ? "Save changes" : "Add policy"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field label="Client" required>
              {fixedClientId || policy ? (
                <Input
                  disabled
                  value={selectedClient.data?.fullName ?? "Loading…"}
                />
              ) : (
                <div className="relative">
                  <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
                  <Input
                    className="pl-9"
                    placeholder="Search by name, phone or code"
                    value={
                      showClientList || !form.clientId
                        ? clientSearch
                        : (selectedClient.data?.fullName ?? "")
                    }
                    onChange={(event) => {
                      setClientSearch(event.target.value);
                      setShowClientList(true);
                    }}
                    onFocus={() => setShowClientList(true)}
                  />
                  {showClientList && (clientResults.data?.rows.length ?? 0) > 0 && (
                    <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                      {clientResults.data?.rows.map((client) => (
                        <li key={client.id}>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50"
                            onClick={() => {
                              set("clientId", client.id);
                              setShowClientList(false);
                              setClientSearch("");
                            }}
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

        {(members.data?.length ?? 0) > 0 && (
          <div>
            <span className="field-label">Members covered</span>
            <div className="flex flex-wrap gap-2">
              {members.data?.map((member) => {
                const selected = form.memberIds?.includes(member.id) ?? false;
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() =>
                      set(
                        "memberIds",
                        selected
                          ? (form.memberIds ?? []).filter((id) => id !== member.id)
                          : [...(form.memberIds ?? []), member.id],
                      )
                    }
                    className={[
                      "rounded-full border px-3 py-1 text-xs transition",
                      selected
                        ? "border-brand-500 bg-brand-50 text-brand-800"
                        : "border-slate-300 text-slate-600 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    {member.fullName}
                    <span className="ml-1 text-slate-400">{member.relationship}</span>
                  </button>
                );
              })}
            </div>
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
      </div>
    </Modal>
  );
}
