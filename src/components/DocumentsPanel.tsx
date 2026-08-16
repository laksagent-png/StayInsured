import { useMutation, useQuery } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Download, FileText, Image as ImageIcon, Paperclip, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api, ApiError } from "../lib/api";
import type { Document, DocumentInput } from "../lib/types";
import { date, fileSize } from "../lib/format";
import { AsyncPanel, Button, Card, Field, Input, Modal, Select, Spinner, useToast } from "./ui";
import { readsOnly } from "../lib/queryClient";

const ATTACHABLE = ["pdf", "png", "jpg", "jpeg", "webp"];

export function DocumentsPanel({ clientId }: { clientId: number }) {
  const toast = useToast();

  const [pending, setPending] = useState<string | undefined>();
  const [viewing, setViewing] = useState<Document | undefined>();

  const documents = useQuery({
    queryKey: ["documents", clientId],
    queryFn: () => api.listDocuments(clientId),
  });

  const pick = useMutation({
    meta: readsOnly,
    mutationFn: async () => {
      const picked = await open({
        multiple: false,
        filters: [{ name: "Documents", extensions: ATTACHABLE }],
      });
      return (picked as string | null) ?? undefined;
    },
    onSuccess: (path) => path && setPending(path),
    onError: (err: ApiError) => toast.error(err.message),
  });

  const saveCopy = useMutation({
    meta: readsOnly,
    mutationFn: async (doc: Document) => {
      const path = await save({ title: "Save a copy", defaultPath: doc.fileName });
      if (!path) return false;
      await api.saveDocumentCopy(doc.id, path);
      return true;
    },
    onSuccess: (saved) => saved && toast.success("Copy saved"),
    onError: (err: ApiError) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteDocument(id),
    onSuccess: () => {
      toast.success("Document removed");
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const rows = documents.data ?? [];

  return (
    <>
      <Card
        title="Documents"
        action={
          <Button
            size="sm"
            variant="ghost"
            icon={<Paperclip className="size-3.5" />}
            loading={pick.isPending}
            onClick={() => pick.mutate()}
          >
            Attach
          </Button>
        }
        bodyClassName=""
      >
        <AsyncPanel query={documents} errorTitle="The paperwork could not be read">
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">
              Keep the policy schedule, the proposal form and the ID proof here. Files are stored
              inside your encrypted book, so a backup carries them with it.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                    {doc.mimeType === "application/pdf" ? (
                      <FileText className="size-4" />
                    ) : (
                      <ImageIcon className="size-4" />
                    )}
                  </span>
                  <button
                    type="button"
                    className="group min-w-0 flex-1 cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
                    onClick={() => setViewing(doc)}
                  >
                    <p className="truncate text-sm font-medium text-slate-700 group-hover:underline">
                      {doc.title}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {doc.policyNumber ? `${doc.policyNumber} · ` : ""}
                      {fileSize(doc.sizeBytes)} · {date(doc.uploadedAt.slice(0, 10))}
                    </p>
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Save a copy of ${doc.title}`}
                    title={`Save a copy of ${doc.title}`}
                    onClick={() => saveCopy.mutate(doc)}
                  >
                    <Download className="size-3.5 text-slate-400" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${doc.title}`}
                    title={`Remove ${doc.title}`}
                    onClick={() => {
                      if (window.confirm(`Remove ${doc.title}?`)) remove.mutate(doc.id);
                    }}
                  >
                    <Trash2 className="size-3.5 text-slate-400" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </AsyncPanel>
      </Card>

      {pending && (
        <AttachModal path={pending} clientId={clientId} onClose={() => setPending(undefined)} />
      )}
      {viewing && <DocumentViewer document={viewing} onClose={() => setViewing(undefined)} />}
    </>
  );
}

/** Mounted only while it is open, so the title starts from the file that was
 * just picked rather than from the last draft. */
function AttachModal({
  path,
  clientId,
  onClose,
}: {
  path: string;
  clientId: number;
  onClose: () => void;
}) {
  const toast = useToast();

  const [form, setForm] = useState<DocumentInput>(() => ({
    clientId,
    path,
    title: fileName(path).replace(/\.[^.]+$/, ""),
    policyId: null,
  }));

  const policies = useQuery({
    queryKey: ["policies", { clientId, forDocuments: true }],
    queryFn: () => api.listPolicies({ clientId, pageSize: 100, sort: "expiry", descending: true }),
  });

  const attach = useMutation({
    mutationFn: () => api.attachDocument(form),
    onSuccess: () => {
      toast.success("Document attached");
      onClose();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      width="sm"
      title="Attach document"
      description={fileName(path)}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={attach.isPending} onClick={() => attach.mutate()}>
            Attach
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title">
          <Input
            value={form.title ?? ""}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            autoFocus
          />
        </Field>
        <Field label="Policy" hint="Leave unset for papers that belong to the client themselves.">
          <Select
            value={form.policyId ?? ""}
            onChange={(event) =>
              setForm({ ...form, policyId: event.target.value ? Number(event.target.value) : null })
            }
          >
            <option value="">No particular policy</option>
            {policies.data?.rows.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.policyNumber} · {policy.insurerName}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

/** Bytes come out of the database and stay in memory: nothing is written to disk
 * unless the agent asks for a copy, and they are dropped again with the window
 * rather than held in the cache. */
function DocumentViewer({
  document: doc,
  onClose,
}: {
  document: Document;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string>();

  const content = useQuery({
    queryKey: ["document-content", doc.id],
    queryFn: () => api.documentContent(doc.id),
    // A scan is megabytes, so its bytes leave memory with the window.
    gcTime: 0,
  });

  useEffect(() => {
    const bytes = content.data;
    if (!bytes) return;
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: doc.mimeType }));
    setUrl(objectUrl);

    return () => {
      setUrl(undefined);
      URL.revokeObjectURL(objectUrl);
    };
  }, [content.data, doc.mimeType]);

  return (
    <Modal
      open
      onClose={onClose}
      width="xl"
      title={doc.title}
      description={`${doc.fileName} · ${fileSize(doc.sizeBytes)}`}
    >
      <AsyncPanel query={content} errorTitle="That document could not be opened">
        {!url ? (
          <Spinner />
        ) : doc.mimeType === "application/pdf" ? (
          <iframe
            src={url}
            title={doc.title}
            className="h-[70vh] w-full rounded-lg border border-slate-200"
          />
        ) : (
          <img
            src={url}
            alt={doc.title}
            className="mx-auto max-h-[70vh] rounded-lg border border-slate-200"
          />
        )}
      </AsyncPanel>
    </Modal>
  );
}

/** The last segment of a path, whichever way its separators lean. */
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? "";
}
