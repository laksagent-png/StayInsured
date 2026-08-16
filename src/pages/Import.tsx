import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileDown,
  FileSpreadsheet,
  ListChecks,
  Upload,
} from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import type { ImportPreview, ImportReport } from "../lib/types";
import { categoryLabels, count } from "../lib/format";
import {
  AsyncPanel,
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Select,
  cx,
  useToast,
} from "../components/ui";
import { readsOnly } from "../lib/queryClient";

/**
 * Import runs in three deliberate moves: map the columns, check without saving,
 * then commit. The check step exists because a bad mapping is easy to make and
 * expensive to undo.
 */
export function ImportPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const mappingId = useId();

  const [preview, setPreview] = useState<ImportPreview>();
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [defaultCategory, setDefaultCategory] = useState("other");
  const [updateExisting, setUpdateExisting] = useState(true);
  const [check, setCheck] = useState<ImportReport>();
  const [result, setResult] = useState<ImportReport>();

  const [filePath, setFilePath] = useState<string>();

  const fields = useQuery({ queryKey: ["importFields"], queryFn: api.importFields });

  const applyPreview = (data?: ImportPreview) => {
    if (!data) return;
    setPreview(data);
    setMapping(offeredMapping(data));
    setCheck(undefined);
    setResult(undefined);
  };

  /**
   * A check speaks for the mapping and the options it ran with. Once either
   * moves it describes a run nobody asked for, so it is put aside and the
   * commit waits for a fresh one.
   */
  const chooseColumn = (key: string, header: string) => {
    setMapping((current) => {
      const next = { ...current };
      if (header) next[key] = header;
      else delete next[key];
      return next;
    });
    setCheck(undefined);
  };

  const chooseDefaultCategory = (value: string) => {
    setDefaultCategory(value);
    setCheck(undefined);
  };

  const chooseUpdateExisting = (value: boolean) => {
    setUpdateExisting(value);
    setCheck(undefined);
  };

  const pickFile = useMutation({
    meta: readsOnly,
    mutationFn: async () => {
      const picked = await open({
        multiple: false,
        filters: [
          { name: "Spreadsheets", extensions: ["xlsx", "xls", "xlsm", "ods", "csv", "tsv"] },
        ],
      });
      if (!picked) return undefined;
      const path = picked as string;
      setFilePath(path);
      return api.previewImport(path);
    },
    onSuccess: applyPreview,
    onError: (err: ApiError) => toast.error(err.message),
  });

  const pickSheet = useMutation({
    meta: readsOnly,
    mutationFn: (sheet: string) => api.previewImport(filePath!, sheet),
    onSuccess: applyPreview,
    onError: (err: ApiError) => toast.error(err.message),
  });

  const template = useMutation({
    meta: readsOnly,
    mutationFn: async () => {
      const path = await save({
        title: "Save import template",
        defaultPath: "stayinsured-import-template.xlsx",
        filters: [{ name: "Excel", extensions: ["xlsx"] }],
      });
      if (!path) return undefined;
      return api.writeImportTemplate(path);
    },
    onSuccess: (path) => path && toast.success("Template saved"),
    onError: (err: ApiError) => toast.error(err.message),
  });

  /** What the finished import brought in, told as it happened. */
  const announce = (report: ImportReport) => {
    if (report.policiesInserted > 0) {
      toast.success(`Imported ${count(report.policiesInserted)} policies`);
    } else if (report.policiesUpdated > 0) {
      toast.success(`Updated ${count(report.policiesUpdated)} policies`);
    } else if (report.failed > 0) {
      toast.error(`Nothing was imported — ${count(report.failed)} rows failed`);
    } else if (report.totalRows === 0) {
      toast.info("That sheet has no rows, so nothing was imported");
    } else {
      toast.info(`Nothing was imported — ${count(report.skipped)} rows were skipped`);
    }
  };

  const runImport = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.runImport({
        path: filePath!,
        sheet: preview?.sheet,
        mapping,
        defaultCategory,
        updateExisting,
        dryRun,
      }),
    onSuccess: (report) => {
      if (report.dryRun) {
        setCheck(report);
        toast.info(
          report.failed > 0
            ? `${count(report.failed)} rows would fail — see the list below`
            : "Everything checks out",
        );
      } else {
        setResult(report);
        queryClient.invalidateQueries();
        announce(report);
      }
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  // A column is named to the core by its heading, so a heading carried by two
  // columns is one choice, answered by the first column that carries it.
  const headers = preview?.headers ?? [];
  const columns = Array.from(new Set(headers.filter((header) => header)));
  const repeatedColumns = columns.filter(
    (header) => headers.filter((other) => other === header).length > 1,
  );

  const requiredMissing = (fields.data ?? [])
    .filter((field) => field.required && !mapping[field.key])
    .map((field) => field.label);

  const groups = Array.from(new Set((fields.data ?? []).map((field) => field.group)));

  // Without the recognised fields there is no mapping to speak of, so neither
  // run can be trusted; while one run is in flight the other would overlap it.
  const canRun = fields.isSuccess && requiredMissing.length === 0 && !runImport.isPending;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-800">Import data</h1>
        <p className="text-sm text-slate-500">
          Bring in an existing spreadsheet. Clients, insurers and plans are created as needed, and
          nothing is saved until you say so.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              icon={<Upload className="size-4" />}
              loading={pickFile.isPending}
              onClick={() => pickFile.mutate()}
            >
              Choose a file
            </Button>
            <Button
              icon={<FileDown className="size-4" />}
              loading={template.isPending}
              onClick={() => template.mutate()}
            >
              Download template
            </Button>
            {preview && (
              <span className="flex items-center gap-2 text-sm text-slate-600">
                <FileSpreadsheet className="size-4 text-brand-600" />
                {preview.fileName}
                <Badge tone="muted">{count(preview.totalRows)} rows</Badge>
              </span>
            )}
          </div>

          {preview && preview.sheetNames.length > 1 && (
            <div className="mt-4 max-w-xs">
              <Field label="Sheet">
                <Select
                  value={preview.sheet}
                  disabled={pickSheet.isPending}
                  onChange={(event) => pickSheet.mutate(event.target.value)}
                >
                  {preview.sheetNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </Card>

        <Card title="How matching works">
          <ul className="space-y-2 text-xs text-slate-600">
            <li>
              Clients are matched on client code, then email, then phone, then name — so re-importing
              the same file will not duplicate them.
            </li>
            <li>
              A policy is identified by insurer plus policy number. Existing ones are updated when the
              option below is on.
            </li>
            <li>Blank client fields get filled in; values already recorded are never overwritten.</li>
            <li>Dates can be DD/MM/YYYY, YYYY-MM-DD or Excel dates. Currency symbols are stripped.</li>
          </ul>
        </Card>
      </div>

      {preview && (
        <>
          <Card
            title="Match your columns to fields"
            action={
              fields.isSuccess ? (
                requiredMissing.length > 0 ? (
                  <Badge tone="danger">Needs {requiredMissing.join(", ")}</Badge>
                ) : (
                  <Badge tone="ok">Ready</Badge>
                )
              ) : undefined
            }
          >
            <AsyncPanel
              query={fields}
              loadingLabel="Reading the recognised fields"
              errorTitle="The recognised fields could not be read"
            >
              <div className="grid gap-6 md:grid-cols-2">
                {groups.map((group) => (
                  <div key={group}>
                    <h3 className="mb-2.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                      {group}
                    </h3>
                    <div className="space-y-2.5">
                      {(fields.data ?? [])
                        .filter((field) => field.group === group)
                        .map((field) => (
                          <div key={field.key} className="flex items-center gap-3">
                            <label
                              htmlFor={`${mappingId}-${field.key}`}
                              className={cx(
                                "w-40 shrink-0 text-sm text-slate-600",
                                field.required &&
                                  "after:ml-0.5 after:text-rose-500 after:content-['*']",
                              )}
                            >
                              {field.label}
                            </label>
                            <Select
                              id={`${mappingId}-${field.key}`}
                              className={cx(
                                "flex-1",
                                field.required && !mapping[field.key] && "border-rose-300",
                              )}
                              value={mapping[field.key] ?? ""}
                              onChange={(event) => chooseColumn(field.key, event.target.value)}
                            >
                              <option value="">Not imported</option>
                              {columns.map((header) => (
                                <option key={header} value={header}>
                                  {header}
                                </option>
                              ))}
                            </Select>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </AsyncPanel>

            {repeatedColumns.length > 0 && (
              <p className="mt-4 flex items-start gap-2 text-xs text-amber-700">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Repeated headings: {repeatedColumns.join(", ")}. Each is read from the first
                  column that carries it — rename the others in the spreadsheet to import them.
                </span>
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-end gap-5 border-t border-slate-100 pt-4">
              <div className="w-56">
                <Field
                  label="Category when not in the file"
                  hint="Used only where the type cannot be worked out"
                >
                  <Select
                    value={defaultCategory}
                    onChange={(event) => chooseDefaultCategory(event.target.value)}
                  >
                    {Object.entries(categoryLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Checkbox
                label="Update records that already exist"
                hint="Off means matching policies are skipped instead"
                checked={updateExisting}
                onChange={chooseUpdateExisting}
              />
              <div className="ml-auto flex gap-2">
                <Button
                  icon={<ListChecks className="size-4" />}
                  loading={runImport.isPending && runImport.variables === true}
                  disabled={!canRun}
                  onClick={() => runImport.mutate(true)}
                >
                  Check without saving
                </Button>
                <Button
                  variant="primary"
                  icon={<ArrowRight className="size-4" />}
                  loading={runImport.isPending && runImport.variables === false}
                  disabled={!canRun || !check}
                  onClick={() => runImport.mutate(false)}
                >
                  Import for real
                </Button>
              </div>
            </div>
            {!check && (
              <p className="mt-2 text-right text-xs text-slate-400">
                Run the check first — it validates every row without writing anything.
              </p>
            )}
          </Card>

          <Card title={`Preview of ${preview.fileName}`} bodyClassName="">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {preview.headers.map((header, index) => (
                      <th
                        key={`${header}-${index}`}
                        className="px-2.5 py-2 text-left font-semibold whitespace-nowrap text-slate-500"
                      >
                        {header || <span className="text-slate-300">(blank)</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleRows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-b border-slate-100">
                      {preview.headers.map((_, columnIndex) => (
                        <td
                          key={columnIndex}
                          className="max-w-48 truncate px-2.5 py-1.5 whitespace-nowrap text-slate-600"
                        >
                          {row[columnIndex] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {(check || result) && <ReportCard report={result ?? check!} final={Boolean(result)} />}
    </div>
  );
}

/**
 * The suggestion, cut down to the columns the mapping editor can offer.
 *
 * A blank heading is not a choice on screen, so carrying one into the import
 * would send a column the operator was never shown and cannot correct.
 */
function offeredMapping(preview: ImportPreview): Record<string, string> {
  const offered = new Set(preview.headers.filter((header) => header));
  return Object.fromEntries(
    Object.entries(preview.suggestedMapping).filter(([, header]) => offered.has(header)),
  );
}

function ReportCard({ report, final }: { report: ImportReport; final: boolean }) {
  return (
    <Card
      title={final ? "Import complete" : "Check results — nothing has been saved"}
      action={
        final ? (
          <Link to="/policies" className="text-xs font-medium text-brand-700 hover:underline">
            View policies
          </Link>
        ) : undefined
      }
    >
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Rows read" value={report.totalRows} />
        <Stat label="Policies added" value={report.policiesInserted} tone="ok" />
        <Stat label="Policies updated" value={report.policiesUpdated} />
        <Stat label="Clients created" value={report.clientsCreated} tone="ok" />
        <Stat label="Skipped" value={report.skipped} tone={report.skipped ? "warning" : undefined} />
        <Stat label="Failed" value={report.failed} tone={report.failed ? "danger" : undefined} />
      </div>

      {report.issues.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
            Rows needing attention
          </h3>
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs">
            {report.issues.map((issue, index) => (
              <li key={index} className="flex gap-2">
                <span className="shrink-0 font-mono text-slate-400">row {issue.row}</span>
                {issue.column && (
                  <span className="shrink-0 font-medium text-slate-500">{issue.column}</span>
                )}
                <span className="text-slate-700">{issue.message}</span>
                {issue.value && (
                  <span className="ml-auto max-w-48 shrink-0 truncate font-mono text-slate-500">
                    “{issue.value}”
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.totalRows === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="size-4" />
          That sheet has no rows, so there is nothing to import.
        </p>
      ) : (
        final &&
        report.failed === 0 &&
        report.issues.length === 0 && (
          <p className="mt-4 flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="size-4" />
            Every row imported cleanly.
          </p>
        )
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warning" | "danger";
}) {
  const tones = {
    ok: "text-emerald-700",
    warning: "text-amber-700",
    danger: "text-rose-700",
  };
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2.5">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={cx("text-lg font-semibold text-slate-800", tone && tones[tone])}>
        {count(value)}
      </p>
    </div>
  );
}
