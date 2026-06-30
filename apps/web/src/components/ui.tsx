import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertCircle, ArrowUpRight, Inbox } from "lucide-react";
import { cn } from "../lib/utils";
import type { Tone } from "../types";

const buttonStyles = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
        secondary: "border bg-white text-slate-700 hover:bg-slate-50",
        ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        danger: "bg-red-600 text-white hover:bg-red-700"
      },
      size: {
        sm: "min-h-8 px-2.5 text-xs",
        md: "min-h-10",
        lg: "min-h-11 px-5"
      }
    },
    defaultVariants: { variant: "primary", size: "md" }
  }
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>) {
  return <button className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border bg-white shadow-panel", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
      <div>
        <h2 className="font-semibold text-slate-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

const toneClasses: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  info: "bg-blue-100 text-blue-700",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-700"
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold", toneClasses[tone])}>
      {children}
    </span>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400",
        className
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn("min-h-10 rounded-lg border bg-white px-3 text-sm text-slate-700 shadow-sm", className)}
      {...props}
    >
      {children}
    </select>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        {eyebrow ? <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-brand-600">{eyebrow}</p> : null}
        <h1 className="text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500 md:text-base">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function StatCard({
  label,
  value,
  detail,
  tone = "neutral"
}: {
  label: string;
  value: string;
  detail: string;
  tone?: Tone;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className={cn("size-2 rounded-full", tone === "danger" ? "bg-red-500" : tone === "warning" ? "bg-amber-500" : tone === "success" ? "bg-emerald-500" : "bg-blue-500")} />
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </Card>
  );
}

export function TableShell({ children }: { children: ReactNode }) {
  return <div className="overflow-auto rounded-b-xl">{children}</div>;
}

export function EmptyState({
  title,
  detail,
  action
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 rounded-xl bg-blue-50 p-3 text-brand-600"><Inbox className="size-5" /></div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Notice({ title, children, tone = "info" }: { title: string; children: ReactNode; tone?: Tone }) {
  return (
    <div className={cn("flex gap-3 rounded-xl border p-4 text-sm", tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-950" : tone === "danger" ? "border-red-200 bg-red-50 text-red-950" : "border-blue-200 bg-blue-50 text-blue-950")}>
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <div><strong className="block">{title}</strong><div className="mt-1 leading-5 opacity-80">{children}</div></div>
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

export function LinkButton({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1 font-semibold text-brand-600">{children}<ArrowUpRight className="size-3.5" /></span>;
}
