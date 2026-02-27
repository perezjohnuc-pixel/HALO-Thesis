import { NavLink, Outlet } from "react-router-dom";
import { Card, CardBody } from "../../components/ui";

function Tab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "rounded-xl px-4 py-2 text-sm font-semibold transition",
          isActive ? "bg-sky-500 text-white" : "bg-slate-900/60 text-slate-200 hover:bg-slate-900",
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
}

export default function AuthPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-sky-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-10">
        <Card className="w-full max-w-lg">
          <CardBody>
            <div className="mb-6">
              <div className="text-2xl font-bold">HALO</div>
              <div className="text-sm text-slate-400">Hygienic Automated Locker Occupancy</div>
            </div>

            <div className="mb-6 flex gap-2">
              <Tab to="/auth/login" label="Login" />
              <Tab to="/auth/register" label="Create account" />
            </div>

            <Outlet />

            <div className="mt-6 text-xs text-slate-500">
              By continuing, you agree to your campus policy and the HALO usage rules.
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
