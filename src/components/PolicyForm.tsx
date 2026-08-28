import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { api, ApiError } from "../lib/api";
import { MAX_TERM } from "../lib/types";
import type { PlanType, Policy, PolicyInput, PolicyStatus, PolicyType, Rider } from "../lib/types";
import {
  categoryLabels,
  date,
  money,
  planTypeLabels,
  policyTypeLabels,
  relationshipLabel,
  riderLabels,
  statusLabels,
} from "../lib/format";
import { Badge, Button, Field, Input, Modal, Select, Textarea, useToast } from "./ui";

/**
 * The day a term bought from `start` runs out: the same date that many years on,
 * less a day, which is what a policy year means in practice. One year unless the
 * agent bought several at once.
 */
function expiryAfter(start: string, years = 1): string {
  if (!start) return "";
  const [year, month, day] = start.split("-").map(Number);
  if (!year || !month || !day) return "";
  const next = new Date(Date.UTC(year + years, month - 1, day));
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

/**
 * Whether a field was left alone. Zero counts as an answer: a nil premium on a
 * staff policy is a figure the agent meant to type.
 */
function unanswered(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
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
  variant: "",
  riders: [],
  planType: null,
  term: null,
  policyType: null,
  broker: "",
  inbuiltRider: "",
  notes: "",
  insuredClientIds: [],
};

/**
 * What a health proposal asks for, on top of what every policy asks for. The
 * insurer's own form is the order, so the screen follows it rather than grouping
 * the fields the way the database stores them.
 */
const HEALTH_REQUIRED: { key: keyof PolicyInput; complaint: string }[] = [
  { key: "productId", complaint: "Choose the plan this health policy is written on" },
  { key: "variant", complaint: "Name the variant of the plan" },
  { key: "riders", complaint: "Choose the riders, or the plan cannot be priced" },
  { key: "planType", complaint: "Say whether the cover is individual or a family floater" },
  { key: "term", complaint: "Choose how many years of cover were bought" },
  { key: "policyType", complaint: "Say whether this is fresh, a portability or a renewal" },
  { key: "sumInsured", complaint: "A health policy needs its sum insured" },
  { key: "premiumAmount", complaint: "A health policy needs its premium" },
  { key: "broker", complaint: "Name the broker this was placed through" },
  { key: "inbuiltRider", complaint: "Name the rider the plan comes with" },
];

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
        variant: policy.variant ?? "",
        riders: policy.riders ?? [],
        planType: policy.planType,
        term: policy.term,
        policyType: policy.policyType,
        broker: policy.broker ?? "",
        inbuiltRider: policy.inbuiltRider ?? "",
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
        expiryDate: expiryAfter(today),
      });
    }
  }, [open, policy, fixedClientId]);

  const set = <K extends keyof PolicyInput>(key: K, value: PolicyInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const isHealth = form.category === "health";

  /**
   * Moves the expiry with whatever the cover now runs from and for. A date the
   * agent typed themselves is left alone; one the form worked out is worked out
   * again.
   */
  const setTerms = (startDate: string, term: number | null) =>
    setForm((current) => {
      const wasSuggested =
        !current.expiryDate || current.expiryDate === expiryAfter(current.startDate, current.term ?? 1);
      // Choosing a term states the length of the cover outright, so it decides
      // the expiry even where a date was typed by hand.
      const restate = term !== current.term || wasSuggested;
      return {
        ...current,
        startDate,
        term,
        expiryDate: restate ? expiryAfter(startDate, term ?? 1) : current.expiryDate,
      };
    });

  const toggleRider = (rider: Rider) =>
    set(
      "riders",
      form.riders?.includes(rider)
        ? form.riders.filter((chosen) => chosen !== rider)
        : [...(form.riders ?? []), rider],
    );

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
        // And the health details belong to health, for the same reason: a
        // policy changed from health to motor should not keep a rider.
        ...(isHealth
          ? null
          : {
              variant: "",
              riders: [],
              planType: null,
              term: null,
              policyType: null,
              broker: "",
              inbuiltRider: "",
            }),
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
    // Health is the one category whose form is filled in completely or not at
    // all: the insurer prices off the variant, the riders and the term, so a
    // policy recorded without them cannot be quoted or renewed from the book.
    if (isHealth) {
      const gap = HEALTH_REQUIRED.find(({ key }) => unanswered(form[key]));
      if (gap) return gap.complaint;
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

  // Every control the form can show, defined once. Which of them appear and in
  // what order is the category's business, further down: a health proposal is
  // taken in the order the insurer's own form asks for it, and the rest keep the
  // general layout.
  const clientField = (
    <Field label="Client" required>
      {fixedClientId || policy ? (
        <Input disabled value={selectedClient.data?.fullName ?? "Loading…"} />
      ) : (
        <div
          className="relative"
          // The list closes as soon as the work moves past it, but not while the
          // focus is on its way to one of its own rows.
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
            // Enter here belongs to the list underneath: it takes the closest
            // match rather than saving a policy that has no client on it yet.
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
                      <span className="block font-medium text-slate-700">{client.fullName}</span>
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
  );

  const policyNumberField = (
    <Field label="Policy number" required>
      <Input
        value={form.policyNumber}
        onChange={(event) => set("policyNumber", event.target.value)}
        placeholder="HS/2026/0091823"
      />
    </Field>
  );

  const insurerField = (
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
  );

  const planField = (
    <Field
      label="Plan"
      required={isHealth}
      hint={form.insurerId ? undefined : "Pick an insurer first"}
    >
      <Select
        value={form.productId ?? ""}
        disabled={!form.insurerId}
        onChange={(event) => set("productId", event.target.value ? Number(event.target.value) : null)}
      >
        <option value="">Not recorded</option>
        {products.data?.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
          </option>
        ))}
      </Select>
    </Field>
  );

  const categoryField = (
    <Field label="Category" required>
      <Select value={form.category} onChange={(event) => set("category", event.target.value)}>
        {Object.entries(categoryLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    </Field>
  );

  const startDateField = (
    <Field label={isHealth ? "Risk start date" : "Start date"} required>
      <Input
        type="date"
        value={form.startDate}
        onChange={(event) => setTerms(event.target.value, form.term ?? null)}
      />
    </Field>
  );

  const expiryDateField = (
    <Field label={isHealth ? "Risk end date" : "Expiry date"} required>
      <Input
        type="date"
        value={form.expiryDate}
        onChange={(event) => set("expiryDate", event.target.value)}
      />
    </Field>
  );

  const sumInsuredField = (
    <Field label="Sum insured" required={isHealth}>
      <Input
        type="number"
        value={form.sumInsured ?? ""}
        onChange={(event) => set("sumInsured", event.target.value ? Number(event.target.value) : null)}
        placeholder="1000000"
      />
    </Field>
  );

  const premiumField = (
    <Field label="Premium" required={isHealth}>
      <Input
        type="number"
        value={form.premiumAmount ?? ""}
        onChange={(event) =>
          set("premiumAmount", event.target.value ? Number(event.target.value) : null)
        }
        placeholder="24500"
      />
    </Field>
  );

  const gstField = (
    <Field label="GST">
      <Input
        type="number"
        value={form.gstAmount ?? ""}
        onChange={(event) => set("gstAmount", event.target.value ? Number(event.target.value) : null)}
      />
    </Field>
  );

  const frequencyField = (
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
  );

  const commissionRateField = (
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
  );

  const commissionAmountField = (
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
  );

  const paymentModeField = (
    <Field label="Payment mode">
      <Input
        value={form.paymentMode ?? ""}
        onChange={(event) => set("paymentMode", event.target.value)}
        placeholder="UPI, cheque, card"
      />
    </Field>
  );

  const nomineeField = (
    <Field label="Nominee">
      <Input
        value={form.nomineeName ?? ""}
        onChange={(event) => set("nomineeName", event.target.value)}
      />
    </Field>
  );

  const nomineeRelationField = (
    <Field label="Nominee relation">
      <Input
        value={form.nomineeRelation ?? ""}
        onChange={(event) => set("nomineeRelation", event.target.value)}
      />
    </Field>
  );

  const vehicleField = (
    <Field label="Vehicle number">
      <Input
        value={form.vehicleNumber ?? ""}
        onChange={(event) => set("vehicleNumber", event.target.value.toUpperCase())}
        placeholder="MH12AB1234"
      />
    </Field>
  );

  const variantField = (
    <Field label="Variant" required>
      <Input
        value={form.variant ?? ""}
        onChange={(event) => set("variant", event.target.value)}
        placeholder="Gold, Platinum"
      />
    </Field>
  );

  const ridersField = (
    <div>
      <span className="field-label">
        Riders
        <span className="text-rose-500"> *</span>
      </span>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(riderLabels) as Rider[]).map((rider) => {
          const chosen = form.riders?.includes(rider) ?? false;
          return (
            <button
              key={rider}
              type="button"
              aria-pressed={chosen}
              onClick={() => toggleRider(rider)}
              className={[
                "rounded-full border px-3 py-1 text-xs transition",
                chosen
                  ? "border-brand-500 bg-brand-50 text-brand-800"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50",
              ].join(" ")}
            >
              {riderLabels[rider]}
            </button>
          );
        })}
      </div>
    </div>
  );

  const planTypeField = (
    <Field label="Plan type" required>
      <Select
        value={form.planType ?? ""}
        onChange={(event) =>
          set("planType", event.target.value ? (event.target.value as PlanType) : null)
        }
      >
        <option value="">Not chosen</option>
        {Object.entries(planTypeLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    </Field>
  );

  const termField = (
    <Field label="Term" required hint="Years bought at once; the risk end date follows">
      <Select
        value={form.term ?? ""}
        onChange={(event) =>
          setTerms(form.startDate, event.target.value ? Number(event.target.value) : null)
        }
      >
        <option value="">Not chosen</option>
        {Array.from({ length: MAX_TERM }, (_, index) => index + 1).map((years) => (
          <option key={years} value={years}>
            {years === 1 ? "1 year" : `${years} years`}
          </option>
        ))}
      </Select>
    </Field>
  );

  const policyTypeField = (
    <Field label="Policy type" required>
      <Select
        value={form.policyType ?? ""}
        onChange={(event) =>
          set("policyType", event.target.value ? (event.target.value as PolicyType) : null)
        }
      >
        <option value="">Not chosen</option>
        {Object.entries(policyTypeLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    </Field>
  );

  const brokerField = (
    <Field label="Broker" required>
      <Input value={form.broker ?? ""} onChange={(event) => set("broker", event.target.value)} />
    </Field>
  );

  const inbuiltRiderField = (
    <Field label="Inbuilt rider" required hint="The one the plan comes with">
      <Input
        value={form.inbuiltRider ?? ""}
        onChange={(event) => set("inbuiltRider", event.target.value)}
      />
    </Field>
  );

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
        {isHealth ? (
          /* A health proposal, in the order the insurer's own form asks for it.
             The category comes first because it is what decides the rest. */
          <>
            <div className="grid gap-4 sm:grid-cols-3">{categoryField}</div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">{clientField}</div>
              {policyNumberField}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {insurerField}
              {planField}
              {variantField}
            </div>

            {ridersField}

            <div className="grid gap-4 sm:grid-cols-4">
              {planTypeField}
              {termField}
              {startDateField}
              {expiryDateField}
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              {policyTypeField}
              {sumInsuredField}
              {premiumField}
              {brokerField}
            </div>

            {/* Past the inbuilt rider the proposal is finished, and what follows
                is the book's own bookkeeping. */}
            <div className="grid gap-4 sm:grid-cols-4">
              {inbuiltRiderField}
              {gstField}
              {frequencyField}
              {paymentModeField}
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              {commissionRateField}
              {commissionAmountField}
              {nomineeField}
              {nomineeRelationField}
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">{clientField}</div>
              {policyNumberField}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {insurerField}
              {planField}
              {categoryField}
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              {startDateField}
              {expiryDateField}
              {sumInsuredField}
              {premiumField}
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              {gstField}
              {frequencyField}
              {commissionRateField}
              {commissionAmountField}
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              {paymentModeField}
              {nomineeField}
              {nomineeRelationField}
              {form.category === "motor" && vehicleField}
            </div>
          </>
        )}

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
