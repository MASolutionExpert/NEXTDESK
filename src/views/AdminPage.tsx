'use client';

import { AdminPanel, AdminClaimCard } from "../components/admin/index.ts";

export default function AdminPage({ user, setUser, isDark, onToggleTheme, onBack }: any) {
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  if (!isAdmin) {
    return (
      <AdminClaimCard
        setUser={setUser}
        isDark={isDark}
        onToggleTheme={onToggleTheme}
        onBack={onBack}
      />
    );
  }

  return <AdminPanel user={user} onBack={onBack} />;
}
