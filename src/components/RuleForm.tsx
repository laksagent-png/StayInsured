import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api, ApiError } from "../lib/api";
import type {
  ReminderAudience,
  ReminderChannel,
  ReminderRule,
  ReminderRuleInput,
} from "../lib/types";
import { categoryLabels } from "../lib/format";
import { Button, Checkbox, Field, Input, Modal, Select, useToast } from "./ui";

const CHANNELS: Array<{ value: ReminderChannel; label: string }> = [
  { value: "email", label: "Email the client" },
  { value: "desktop", label: "Notify me on this computer" },
  { value: "both", label: "Both" },
];

/** Describes the timing in the words the agent would use. */
export function timingLabel(offsetDays: number): string {
  if (offsetDays === 0) return "On the expiry date";
  const days = Math.abs(offsetDays);
  const spell = `${days} ${days === 1 ? "day" : "days"}`;
  return offsetDays > 0 ? `${spell} before expiry` : `${spell} after expiry`;
}

export function RuleForm({
  rule,
  onClose,
}: {
  rule: ReminderRule | "new";
  onClose: () => void;
}) {
  const toast = useToast();
  const [messageProblem, setMessageProblem] = useState<string>();

  const [form, setForm] = useState<ReminderRuleInput>(
    rule === "new"
      ? {
          name: "",
          offsetDays: 30,
          category: null,
          audience: "client",
          channel: "email",
          templateId: null,
          isActive: true,
          // A new rule carries no place in the ladder: the core gives it the end.
        }
      : {
          name: rule.name,
          offsetDays: rule.offsetDays,
          category: rule.category,
          audience: rule.audience,
          channel: rule.channel,
          templateId: rule.templateId,
          isActive: rule.isActive,
          sortOrder: rule.sortOrder,
        },
  );

  const templates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });

  const save = useMutation({
    mutationFn: async () => {
      // The box offers a year either side of expiry, which is as far as the
      // core will take: anything beyond it is refused rather than saved.
      const offsetDays = Math.max(-365, Math.min(365, form.offsetDays));
      if (rule === "new") {
        await api.createRule({ ...form, offsetDays });
      } else {
        await api.updateRule(rule.id, { ...form, offsetDays });
      }
    },
    onSuccess: () => {
      toast.success("Rule saved");
      onClose();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const set = <K extends keyof ReminderRuleInput>(key: K, value: ReminderRuleInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  // A rule that writes to a client with no message has nothing to say, and the
  // core refuses it. Saying so under the box beats sending it and reporting the
  // refusal back over the top of the form.
  const submit = () => {
    if (form.audience === "client" && !form.templateId) {
      setMessageProblem("Choose the message this rule sends to the client");
      return;
    }
    save.mutate();
  };

  // Days are entered as a positive number; before or after is a separate choice,
  // which reads better than asking someone to type a negative number.
  const magnitude = Math.abs(form.offsetDays);
  const side = form.offsetDays < 0 ? "after" : "before";

  return (
    <Modal
      open
      onClose={onClose}
      width="md"
      title={rule === "new" ? "New rule" : form.name || "Rule"}
      description="A rule sends one message, once, to every policy that reaches this point in its year."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save rule
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required hint="How this rule appears in the ladder and in history.">
          <Input
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="30 days before expiry"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Days" required>
            <Input
              type="number"
              min={0}
              max={365}
              value={magnitude}
              onChange={(event) => {
                const days = Math.abs(Number(event.target.value) || 0);
                set("offsetDays", side === "after" ? -days : days);
              }}
            />
          </Field>
          <Field label="Counted" hint={timingLabel(form.offsetDays)}>
            <Select
              value={side}
              onChange={(event) =>
                set("offsetDays", event.target.value === "after" ? -magnitude : magnitude)
              }
            >
              <option value="before">before expiry</option>
              <option value="after">after expiry</option>
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Applies to" hint="Leave as all unless this rule is for one kind of cover.">
            <Select
              value={form.category ?? ""}
              onChange={(event) => set("category", event.target.value || null)}
            >
              <option value="">All policy types</option>
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Goes to">
            <Select
              value={form.audience}
              onChange={(event) => {
                setMessageProblem(undefined);
                set("audience", event.target.value as ReminderAudience);
              }}
            >
              <option value="client">The client</option>
              <option value="provider">Me</option>
            </Select>
          </Field>
        </div>

        <Field label="How">
          <Select
            value={form.channel}
            onChange={(event) => set("channel", event.target.value as ReminderChannel)}
          >
            {CHANNELS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Message"
          required={form.audience === "client"}
          error={messageProblem}
          hint="Edit the wording under Messages."
        >
          <Select
            value={form.templateId ?? ""}
            onChange={(event) => {
              setMessageProblem(undefined);
              set("templateId", Number(event.target.value) || null);
            }}
          >
            <option value="">Choose a message</option>
            {(templates.data ?? []).map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </Select>
        </Field>

        <Checkbox
          label="Active"
          checked={form.isActive ?? true}
          onChange={(value) => set("isActive", value)}
          hint="An inactive rule stays in the list but sends nothing."
        />
      </div>
    </Modal>
  );
}
