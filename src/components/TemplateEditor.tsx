import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { api, ApiError } from "../lib/api";
import type { EmailTemplate, EmailTemplateInput, TemplateTrigger } from "../lib/types";
import { Badge, Button, Field, Input, Modal, Select, useToast } from "./ui";

const TRIGGERS: Array<{ value: TemplateTrigger; label: string; hint: string }> = [
  {
    value: "expiry_reminder",
    label: "Before expiry",
    hint: "Sent by the rules that count down to the expiry date",
  },
  {
    value: "post_expiry",
    label: "After expiry",
    hint: "For chasing cover that has already lapsed",
  },
  {
    value: "renewal_confirmation",
    label: "Renewal confirmation",
    hint: "Sent by hand after a renewal is completed",
  },
  { value: "welcome", label: "Welcome", hint: "For a new client" },
  { value: "annual_summary", label: "Annual summary", hint: "A year of cover in one message" },
  {
    value: "provider_digest",
    label: "Your daily digest",
    hint: "The summary that comes to you, not to a client",
  },
  { value: "custom", label: "Anything else", hint: "Not attached to a rule" },
];

const BLANK: EmailTemplateInput = {
  name: "",
  trigger: "expiry_reminder",
  subject: "",
  bodyHtml:
    '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">\n' +
    "  <p>Dear {{client_name}},</p>\n  <p></p>\n" +
    "  <p>Warm regards,<br />{{provider_name}}</p>\n</div>",
  isActive: true,
};

/**
 * Writing and previewing one message. The preview renders against a real policy
 * from the book where there is one, so the agent reads what a client will read
 * rather than a page of braces.
 */
export function TemplateEditor({
  template,
  onClose,
}: {
  template: EmailTemplate | "new";
  onClose: () => void;
}) {
  const toast = useToast();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const lastFocused = useRef<"subject" | "body">("body");

  const [subjectProblem, setSubjectProblem] = useState<string>();

  const [form, setForm] = useState<EmailTemplateInput>(
    template === "new"
      ? BLANK
      : {
          name: template.name,
          trigger: template.trigger,
          subject: template.subject,
          bodyHtml: template.bodyHtml,
          isActive: template.isActive,
        },
  );

  const placeholders = useQuery({
    queryKey: ["placeholders"],
    queryFn: api.templatePlaceholders,
    staleTime: Infinity,
  });

  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewTemplate>>>();
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .previewTemplate(form.subject, form.bodyHtml)
        .then((result) => {
          if (!cancelled) setPreview(result);
        })
        .catch(() => {
          /* A preview that cannot render is not worth interrupting typing for. */
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [form.subject, form.bodyHtml]);

  const save = useMutation({
    mutationFn: async () => {
      if (template === "new") {
        await api.createTemplate(form);
      } else {
        await api.updateTemplate(template.id, form);
      }
    },
    onSuccess: () => {
      toast.success("Message saved");
      onClose();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  // A message with no subject line arrives as a blank in the client's inbox, and
  // the core refuses it. The box it belongs in is the place to say so.
  const submit = () => {
    if (!form.subject.trim()) {
      setSubjectProblem("Subject is required");
      subjectRef.current?.focus();
      return;
    }
    save.mutate();
  };

  /** Drops a placeholder where the cursor was, rather than at the end. */
  function insert(name: string) {
    const token = `{{${name}}}`;
    if (lastFocused.current === "subject") {
      const field = subjectRef.current;
      const at = field?.selectionStart ?? form.subject.length;
      const next = form.subject.slice(0, at) + token + form.subject.slice(at);
      setSubjectProblem(undefined);
      setForm({ ...form, subject: next });
      window.setTimeout(() => field?.setSelectionRange(at + token.length, at + token.length), 0);
      return;
    }
    const field = bodyRef.current;
    const at = field?.selectionStart ?? form.bodyHtml.length;
    const next = form.bodyHtml.slice(0, at) + token + form.bodyHtml.slice(at);
    setForm({ ...form, bodyHtml: next });
    window.setTimeout(() => {
      field?.focus();
      field?.setSelectionRange(at + token.length, at + token.length);
    }, 0);
  }

  const trigger = TRIGGERS.find((t) => t.value === form.trigger);

  return (
    <Modal
      open
      onClose={onClose}
      width="xl"
      title={template === "new" ? "New message" : form.name || "Message"}
      description="Write the message, then check the preview on the right before saving."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save message
          </Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Policy expiry reminder"
              />
            </Field>
            <Field label="Used for" hint={trigger?.hint}>
              <Select
                value={form.trigger}
                onChange={(event) =>
                  setForm({ ...form, trigger: event.target.value as TemplateTrigger })
                }
              >
                {TRIGGERS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Subject" required error={subjectProblem}>
            <Input
              ref={subjectRef}
              value={form.subject}
              onFocus={() => (lastFocused.current = "subject")}
              onChange={(event) => {
                setSubjectProblem(undefined);
                setForm({ ...form, subject: event.target.value });
              }}
              placeholder="Your {{category_label}} policy expires on {{expiry_date}}"
            />
          </Field>

          <Field
            label="Message"
            required
            hint="Written as HTML. A plain text copy is sent alongside it automatically."
          >
            <textarea
              ref={bodyRef}
              value={form.bodyHtml}
              onFocus={() => (lastFocused.current = "body")}
              onChange={(event) => setForm({ ...form, bodyHtml: event.target.value })}
              spellCheck={false}
              className="input-base h-72 resize-y font-mono text-xs leading-relaxed"
            />
          </Field>

          <div>
            <p className="field-label">Insert a detail</p>
            <p className="mb-2 text-xs text-slate-400">
              Click one to drop it in where the cursor is. It is replaced with the real value when
              the message goes out.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(placeholders.data ?? []).map((item) => (
                <button
                  key={item.name}
                  type="button"
                  title={item.description}
                  onClick={() => insert(item.name)}
                  className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600 transition hover:bg-brand-50 hover:text-brand-700"
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="field-label mb-0">Preview</p>
            {preview?.samplePolicy ? (
              <Badge tone="info">{preview.samplePolicy}</Badge>
            ) : (
              <Badge tone="muted">Example details</Badge>
            )}
          </div>

          {preview && preview.unknownPlaceholders.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Nothing will fill {preview.unknownPlaceholders.map((n) => `{{${n}}}`).join(", ")}, so
              it will arrive as a gap. Check the spelling against the list on the left.
            </p>
          )}

          <div className="rounded-lg border border-slate-200">
            <div className="border-b border-slate-100 bg-slate-50/60 px-3 py-2">
              <p className="text-xs text-slate-400">Subject</p>
              <p className="text-sm font-medium text-slate-800">
                {preview?.subject || "—"}
              </p>
            </div>
            <div
              className="max-h-[26rem] overflow-y-auto bg-white px-3 py-3 text-sm"
              // The agent is previewing their own message, and the same HTML is
              // what leaves the building.
              dangerouslySetInnerHTML={{ __html: preview?.html ?? "" }}
            />
          </div>

          <details className="rounded-lg border border-slate-200 px-3 py-2">
            <summary className="cursor-pointer text-xs text-slate-500">
              Plain text copy, for mail apps that will not show the formatted one
            </summary>
            <pre className="mt-2 max-h-48 overflow-y-auto text-xs whitespace-pre-wrap text-slate-600">
              {preview?.text ?? ""}
            </pre>
          </details>
        </div>
      </div>
    </Modal>
  );
}
