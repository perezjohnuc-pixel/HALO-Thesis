import React from "react";
import clsx from "clsx";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
}) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex items-center justify-center rounded-xl font-semibold transition focus:outline-none focus:ring-2 focus:ring-sky-400/40 disabled:opacity-50 disabled:cursor-not-allowed",
        variant === "primary" && "bg-sky-500 text-white hover:bg-sky-400",
        variant === "secondary" && "bg-slate-800 text-slate-100 hover:bg-slate-700",
        variant === "danger" && "bg-red-500 text-white hover:bg-red-400",
        variant === "ghost" && "bg-transparent text-slate-100 hover:bg-slate-900/70",
        size === "sm" && "h-9 px-3 text-sm",
        size === "md" && "h-11 px-4 text-sm",
        className
      )}
    />
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "h-11 w-full rounded-xl bg-slate-900/60 border border-slate-800 px-3 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400/40",
        className
      )}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={clsx("text-sm text-slate-300", className)} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={clsx(
        "rounded-2xl border border-slate-800 bg-slate-950/40 shadow-sm",
        className
      )}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={clsx("p-4 border-b border-slate-800", className)} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={clsx("p-4", className)} />;
}

export function Badge({ className, color = "slate", ...props }: React.HTMLAttributes<HTMLSpanElement> & {
  color?: "slate" | "green" | "yellow" | "amber" | "red" | "blue" | "sky";
}) {
  const c =
    color === "green"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/20"
      : (color === "yellow" || color === "amber")
        ? "bg-amber-500/15 text-amber-300 border-amber-500/20"
        : color === "red"
          ? "bg-red-500/15 text-red-300 border-red-500/20"
        : (color === "blue" || color === "sky")
            ? "bg-sky-500/15 text-sky-300 border-sky-500/20"
            : "bg-slate-500/15 text-slate-300 border-slate-500/20";

  return (
    <span
      {...props}
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs",
        c,
        className
      )}
    />
  );
}

// Simple styled select (used in Admin filters)
export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(
        "h-11 w-full rounded-xl bg-slate-900/60 border border-slate-800 px-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400/40",
        className
      )}
    >
      {children}
    </select>
  );
}
