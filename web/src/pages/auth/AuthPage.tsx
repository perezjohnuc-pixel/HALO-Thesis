import { NavLink, Outlet } from "react-router-dom";
import { Card, CardBody } from "../../components/ui";

function Tab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "rounded-xl px-4 py-2 text-sm font-semibold transition",
          isActive
            ? "bg-cyan-500/90 text-white shadow-sm shadow-cyan-500/20"
            : "bg-slate-800/70 text-slate-200 hover:bg-slate-700/80",
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
}

export default function AuthPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-10 top-10 h-56 w-56 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute right-0 bottom-12 h-72 w-72 rounded-full bg-indigo-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-10">
        <Card className="w-full max-w-lg">
          <CardBody>
            <div className="mb-6">
              <div className="text-2xl font-bold tracking-wide">HALO</div>
              <div className="text-sm text-slate-300/90">Hygienic Automated Locker Occupancy</div>
            </div>

            <div className="mb-6 flex gap-2">
              <Tab to="/auth/login" label="Login" />
              <Tab to="/auth/register" label="Create account" />
            </div>

            <Outlet />

            <div className="mt-6 text-xs text-slate-400">
              By continuing, you agree to your campus policy and the HALO usage rules.
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
