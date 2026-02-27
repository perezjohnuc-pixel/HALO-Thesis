import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import LoginPage from "./pages/auth/LoginPage";
import RegisterPage from "./pages/auth/RegisterPage";
import Layout from "./components/Layout";
import UserHome from "./pages/user/UserHome";
import LockersPage from "./pages/user/LockersPage";
import MyBookingPage from "./pages/user/MyBookingPage";
import HistoryPage from "./pages/user/HistoryPage";
import AdminHome from "./pages/admin/AdminHome";
import AdminLockersPage from "./pages/admin/AdminLockersPage";
import AdminBookingsPage from "./pages/admin/AdminBookingsPage";
import AdminLogsPage from "./pages/admin/AdminLogsPage";
import AdminDevicesPage from "./pages/admin/AdminDevicesPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-6">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { userDoc, loading } = useAuth();
  if (loading) return <div className="p-6">Loading...</div>;
  if (userDoc?.role !== "admin") return <Navigate to="/app" replace />;
  return <>{children}</>;
}

function Landing() {
  const { userDoc, loading } = useAuth();
  if (loading) return <div className="p-6">Loading...</div>;
  if (!userDoc) return <Navigate to="/login" replace />;
  return <Navigate to={userDoc.role === "admin" ? "/admin" : "/app"} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route
          path="/app"
          element={
            <RequireAuth>
              <Layout kind="user" />
            </RequireAuth>
          }
        >
          <Route index element={<UserHome />} />
          <Route path="lockers" element={<LockersPage />} />
          <Route path="booking" element={<MyBookingPage />} />
          <Route path="history" element={<HistoryPage />} />
        </Route>

        <Route
          path="/admin"
          element={
            <RequireAuth>
              <RequireAdmin>
                <Layout kind="admin" />
              </RequireAdmin>
            </RequireAuth>
          }
        >
          <Route index element={<AdminHome />} />
          <Route path="lockers" element={<AdminLockersPage />} />
          <Route path="bookings" element={<AdminBookingsPage />} />
          <Route path="logs" element={<AdminLogsPage />} />
          <Route path="devices" element={<AdminDevicesPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
