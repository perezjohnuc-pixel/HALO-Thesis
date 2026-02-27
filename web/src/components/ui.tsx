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
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-300/60 disabled:opacity-50 disabled:cursor-not-allowed",
        variant === "primary" && "bg-cyan-500/90 text-white shadow-sm shadow-cyan-500/20 hover:bg-cyan-400",
        variant === "secondary" && "bg-slate-800/85 text-slate-100 ring-1 ring-slate-700/70 hover:bg-slate-700/90",
        variant === "danger" && "bg-rose-500/90 text-white shadow-sm shadow-rose-500/20 hover:bg-rose-400",
        variant === "ghost" && "bg-transparent text-slate-100 hover:bg-slate-800/70",
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
        "h-11 w-full rounded-xl border border-slate-700/80 bg-slate-900/55 px-3 text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-300/60",
        className
      )}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={clsx("text-sm font-medium text-slate-300", className)} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={clsx(
        "rounded-2xl border border-slate-700/75 bg-slate-900/45 shadow-lg shadow-slate-950/20 backdrop-blur-sm",
        className
      )}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={clsx("p-4 border-b border-slate-700/80", className)} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={clsx("p-4", className)} />;
}

export function Badge({ className, color = "slate", ...props }: React.HTMLAttributes<HTMLSpanElement> & {
  color?: "slate" | "green" | "yellow" | "amber" | "red" | "blue" | "sky";
}) {
  const c =
    color === "green"
      ? "bg-emerald-500/15 text-emerald-200 border-emerald-400/30"
      : (color === "yellow" || color === "amber")
        ? "bg-amber-500/15 text-amber-200 border-amber-400/30"
        : color === "red"
          ? "bg-rose-500/15 text-rose-200 border-rose-400/30"
        : (color === "blue" || color === "sky")
            ? "bg-cyan-500/15 text-cyan-200 border-cyan-400/30"
            : "bg-slate-500/15 text-slate-200 border-slate-400/30";

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
        "h-11 w-full rounded-xl border border-slate-700/80 bg-slate-900/55 px-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/60",
        className
      )}
    >
      {children}
    </select>
  );
}
