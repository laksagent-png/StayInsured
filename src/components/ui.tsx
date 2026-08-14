import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- button

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white shadow-xs hover:bg-brand-700 focus-visible:ring-brand-500/40 disabled:bg-brand-300",
  secondary:
    "border border-slate-300 bg-white text-slate-700 shadow-xs hover:bg-slate-50 focus-visible:ring-slate-400/40",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-400/40",
  danger:
    "bg-rose-600 text-white shadow-xs hover:bg-rose-700 focus-visible:ring-rose-500/40 disabled:bg-rose-300",
  subtle: "bg-brand-50 text-brand-800 hover:bg-brand-100 focus-visible:ring-brand-500/30",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition",
        "focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        buttonStyles[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- form fields

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      {label && (
        <span className="field-label">
          {label}
          {required && <span className="text-rose-500"> *</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-rose-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-400">{hint}</span>
      ) : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} {...rest} className={cx("input-base", className)} />;
  },
);

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx("input-base appearance-none pr-8", className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx("input-base min-h-20 resize-y", className)} />;
}

export function Checkbox({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
      />
      <span>
        <span className="block text-sm text-slate-700">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------- surfaces

export function Card({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("card overflow-hidden", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
          {action}
        </header>
      )}
      <div className={cx(bodyClassName ?? "p-4")}>{children}</div>
    </section>
  );
}

type Tone = "brand" | "danger" | "warning" | "ok" | "muted" | "info";

const toneStyles: Record<Tone, string> = {
  brand: "bg-brand-50 text-brand-700 ring-brand-600/20",
  danger: "bg-rose-50 text-rose-700 ring-rose-600/20",
  warning: "bg-amber-50 text-amber-700 ring-amber-600/20",
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  muted: "bg-slate-100 text-slate-600 ring-slate-500/15",
  info: "bg-sky-50 text-sky-700 ring-sky-600/20",
};

export function Badge({
  tone = "muted",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        toneStyles[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-slate-300">{icon}</div>}
      <div>
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="size-4 animate-spin" />
      {label ?? "Loading"}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          "card my-8 w-full shadow-xl",
          widths[width],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-slate-800">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
      <span>
        {from}–{to} of {new Intl.NumberFormat("en-IN").format(total)}
      </span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span className="px-2">
          Page {page} of {pages}
        </span>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- toasts

type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((toast) => toast.id !== id)),
      tone === "error" ? 7000 : 4000,
    );
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
      info: (message) => push("info", message),
    }),
    [push],
  );

  const icons: Record<ToastTone, ReactNode> = {
    success: <CheckCircle2 className="size-4 text-emerald-600" />,
    error: <AlertTriangle className="size-4 text-rose-600" />,
    info: <Info className="size-4 text-sky-600" />,
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-100 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-lg"
          >
            {icons[toast.tone]}
            <span className="flex-1">{toast.message}</span>
            <button
              onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
              className="text-slate-400 hover:text-slate-600"
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
