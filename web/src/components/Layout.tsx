import { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Boxes,
  Clock,
  Home,
  LogOut,
  Menu,
  Shield,
  Smartphone,
  X,
} from "lucide-react";
import { Button } from "./ui";
import { useAuth } from "../lib/auth";

type Kind = "user" | "admin";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

function navLinkClass(isActive: boolean) {
  return [
    "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
    isActive
      ? "bg-sky-500/12 text-sky-200 ring-1 ring-sky-500/20"
      : "text-slate-200 hover:bg-slate-900/60 hover:text-white",
  ].join(" ");
}

const NAV_USER: NavItem[] = [
  { to: "/app", label: "Dashboard", icon: Home },
  { to: "/app/lockers", label: "Lockers", icon: Boxes },
  { to: "/app/booking", label: "My Booking", icon: Smartphone },
  { to: "/app/history", label: "History", icon: Clock },
];

const NAV_ADMIN: NavItem[] = [
  { to: "/admin", label: "Overview", icon: Home },
  { to: "/admin/lockers", label: "Lockers", icon: Boxes },
  { to: "/admin/bookings", label: "Bookings", icon: Smartphone },
  { to: "/admin/logs", label: "Logs", icon: Clock },
  { to: "/admin/devices", label: "Device Simulator", icon: Shield },
];

function getHeader(pathname: string, kind: Kind): { title: string; subtitle: string } {
  const map: Record<string, { title: string; subtitle: string }> = {
    "/app": { title: "Dashboard", subtitle: "Status, quick actions, and your active booking" },
    "/app/lockers": { title: "Lockers", subtitle: "Reserve an available locker" },
    "/app/booking": { title: "My Booking", subtitle: "QR token and timers (scan + payment)" },
    "/app/history": { title: "History", subtitle: "Your past bookings" },
    "/admin": { title: "Admin Overview", subtitle: "Monitor lockers, bookings, and system health" },
    "/admin/lockers": { title: "Admin: Lockers", subtitle: "Provision lockers and reset state" },
    "/admin/bookings": { title: "Admin: Bookings", subtitle: "Review and manage bookings" },
    "/admin/logs": { title: "Admin: Logs", subtitle: "System audit trail" },
    "/admin/devices": { title: "Admin: Device Simulator", subtitle: "Simulate QR scan + payment + disinfection" },
  };

  if (map[pathname]) return map[pathname];
  if (kind === "admin") return { title: "Admin", subtitle: "" };
  return { title: "HALO", subtitle: "" };
}

export default function Layout({ kind }: { kind: Kind }) {
  const { user, userDoc, signOut } = useAuth();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = useMemo(() => (kind === "admin" ? NAV_ADMIN : NAV_USER), [kind]);
  const header = useMemo(() => getHeader(loc.pathname, kind), [loc.pathname, kind]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-sky-950 text-slate-100">
      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 shrink-0 md:block">
          <div className="sticky top-6 rounded-2xl border border-slate-800 bg-slate-950/55 p-4 shadow-sm backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-sky-500/15 ring-1 ring-sky-500/20">
                <Shield className="size-5 text-sky-300" />
              </div>
              <div>
                <div className="text-sm font-semibold tracking-wide">HALO</div>
                <div className="text-xs text-slate-400">Helmet Locker System</div>
              </div>
            </div>

            <nav className="mt-4 space-y-1">
              {nav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => navLinkClass(isActive)}
                >
                  <item.icon className="size-4 opacity-90" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>

            {kind === "user" && userDoc?.role === "admin" ? (
              <div className="mt-3">
                <NavLink to="/admin" className={({ isActive }) => navLinkClass(isActive)}>
                  <Shield className="size-4 opacity-90" />
                  <span>Admin</span>
                </NavLink>
              </div>
            ) : null}

            <div className="mt-6 border-t border-slate-800 pt-4">
              <div className="text-xs text-slate-400">Signed in as</div>
              <div className="truncate text-sm">{user?.email ?? "—"}</div>
              <Button
                className="mt-3 w-full"
                variant="ghost"
                onClick={() => signOut()}
                title="Sign out"
              >
                <LogOut className="size-4" />
                Sign out
              </Button>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400">
                {kind === "admin" ? "Admin" : "Customer"}
              </div>
              <h1 className="mt-1 text-2xl font-semibold">{header.title}</h1>
              {header.subtitle ? <p className="mt-1 text-sm text-slate-400">{header.subtitle}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="md:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="size-5" />
              </Button>
            </div>
          </div>

          <Outlet />
        </main>
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            className="absolute inset-0 bg-black/50"
            aria-label="Close menu overlay"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-[85%] max-w-xs overflow-auto border-r border-slate-800 bg-slate-950/95 p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-xl bg-sky-500/15 ring-1 ring-sky-500/20">
                  <Shield className="size-5 text-sky-300" />
                </div>
                <div>
                  <div className="text-sm font-semibold">HALO</div>
                  <div className="text-xs text-slate-400">{kind === "admin" ? "Admin" : "Customer"}</div>
                </div>
              </div>
              <Button variant="ghost" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                <X className="size-5" />
              </Button>
            </div>

            <nav className="mt-4 space-y-1">
              {nav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => navLinkClass(isActive)}
                >
                  <item.icon className="size-4 opacity-90" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
              {kind === "user" && userDoc?.role === "admin" ? (
                <NavLink
                  to="/admin"
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => navLinkClass(isActive)}
                >
                  <Shield className="size-4 opacity-90" />
                  <span>Admin</span>
                </NavLink>
              ) : null}
            </nav>

            <div className="mt-6 border-t border-slate-800 pt-4">
              <div className="text-xs text-slate-400">Signed in as</div>
              <div className="truncate text-sm">{user?.email ?? "—"}</div>
              <Button
                className="mt-3 w-full"
                variant="ghost"
                onClick={() => signOut()}
                title="Sign out"
              >
                <LogOut className="size-4" />
                Sign out
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
