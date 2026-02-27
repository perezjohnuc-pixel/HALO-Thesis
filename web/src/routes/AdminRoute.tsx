import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function AdminRoute() {
  const { user, role, loading } = useAuth();

  if (loading) {
    return <div className="p-8 text-sm text-slate-300">Loading...</div>;
  }
  if (!user) {
    return <Navigate to="/auth/login" replace />;
  }
  if (role !== "admin") {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
