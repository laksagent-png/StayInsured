import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { api, ApiError } from "../lib/api";
import type { Policy, RenewalInput } from "../lib/types";
import { categoryLabel, date, money } from "../lib/format";
import { Button, Field, Input, Modal, Textarea, useToast } from "./ui";

function dayAfter(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

function yearLater(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year + 1, month - 1, day - 1));
  return next.toISOString().slice(0, 10);
}

/**
 * Renewing writes a new policy year rather than editing the old one, so last
 * year's premium and sum insured stay on record.
 */
export function RenewModal({
  policy,
  onClose,
}: {
  policy?: Policy;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<RenewalInput>({ policyId: 0 });
  const [error, setError] = useState<string | null>(null);

  const chain = useQuery({
    queryKey: ["chain", policy?.id],
    queryFn: () => api.policyChain(policy!.id),
    enabled: Boolean(policy),
  });

  useEffect(() => {
    if (!policy) return;
    const start = dayAfter(policy.expiryDate);
    setError(null);
    setForm({
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      startDate: start,
      expiryDate: yearLater(start),
      sumInsured: policy.sumInsured,
      premiumAmount: policy.premiumAmount,
      gstAmount: policy.gstAmount,
      commissionRate: policy.commissionRate,
      commissionExpected: null,
      notes: "",
    });
  }, [policy]);

  const renew = useMutation({
    mutationFn: () => api.renewPolicy(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Renewal recorded");
      onClose();
    },
    onError: (err: ApiError) => setError(err.message),
  });

  const set = <K extends keyof RenewalInput>(key: K, value: RenewalInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  if (!policy) return null;

  const premiumChange =
    form.premiumAmount && policy.premiumAmount
      ? Math.round(((form.premiumAmount - policy.premiumAmount) / policy.premiumAmount) * 100)
      : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Renew ${policy.clientName}'s ${categoryLabel(policy.category)} policy`}
      description="The expiring year is kept and marked as renewed."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={renew.isPending} onClick={() => renew.mutate()}>
            Record renewal
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3.5 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-400 uppercase">Expiring year</p>
            <p className="truncate font-medium text-slate-700">
              {policy.policyNumber} · {policy.insurerName}
            </p>
            <p className="text-xs text-slate-500">
              {date(policy.startDate)} → {date(policy.expiryDate)} · {money(policy.premiumAmount)}
            </p>
          </div>
          <ArrowRight className="size-4 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-400 uppercase">Year {policy.policyYear + 1}</p>
            <p className="truncate font-medium text-slate-700">
              {form.policyNumber || policy.policyNumber}
            </p>
            <p className="text-xs text-slate-500">
              {date(form.startDate ?? null)} → {date(form.expiryDate ?? null)}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="New policy number"
            hint="Insurers often issue a fresh number on renewal"
          >
            <Input
              value={form.policyNumber ?? ""}
              onChange={(event) => set("policyNumber", event.target.value)}
            />
          </Field>
          <Field label="Sum insured">
            <Input
              type="number"
              value={form.sumInsured ?? ""}
              onChange={(event) =>
                set("sumInsured", event.target.value ? Number(event.target.value) : null)
              }
            />
          </Field>
          <Field label="Start date">
            <Input
              type="date"
              value={form.startDate ?? ""}
              onChange={(event) => set("startDate", event.target.value)}
            />
          </Field>
          <Field label="Expiry date">
            <Input
              type="date"
              value={form.expiryDate ?? ""}
              onChange={(event) => set("expiryDate", event.target.value)}
            />
          </Field>
          <Field
            label="Premium"
            hint={
              premiumChange !== null && premiumChange !== 0
                ? `${premiumChange > 0 ? "+" : ""}${premiumChange}% versus last year`
                : undefined
            }
          >
            <Input
              type="number"
              value={form.premiumAmount ?? ""}
              onChange={(event) =>
                set("premiumAmount", event.target.value ? Number(event.target.value) : null)
              }
            />
          </Field>
          <Field label="GST">
            <Input
              type="number"
              value={form.gstAmount ?? ""}
              onChange={(event) =>
                set("gstAmount", event.target.value ? Number(event.target.value) : null)
              }
            />
          </Field>
        </div>

        <Field label="Notes for this renewal">
          <Textarea
            value={form.notes ?? ""}
            onChange={(event) => set("notes", event.target.value)}
            placeholder="Sum insured increased on the client's request"
          />
        </Field>

        {(chain.data?.length ?? 0) > 1 && (
          <div>
            <span className="field-label">History</span>
            <ul className="space-y-1 text-xs text-slate-500">
              {chain.data?.map((year) => (
                <li key={year.id} className="flex justify-between gap-3">
                  <span>
                    Year {year.policyYear} · {date(year.startDate)} → {date(year.expiryDate)}
                  </span>
                  <span>{money(year.premiumAmount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </div>
    </Modal>
  );
}
