import { notFound } from "next/navigation";

import { api } from "@/lib/api";
import type { Principal } from "@/lib/types";

import { AdminTabs } from "./tabs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await api<Principal>("/auth/me");
  if (me.role !== "admin") notFound(); // the API refuses too; this keeps the screens out of sight
  return (
    <div className="space-y-7">
      <div className="rise">
        <h1 className="title">Administration</h1>
      </div>
      <AdminTabs />
      {children}
    </div>
  );
}
