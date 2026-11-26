"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { api } from "@/lib/api";

/** Opening a notification marks it read, then goes to its case. Bound arguments reach the
 *  browser in plain text, so the path is built here from the case number, never taken whole. */
export async function openNotice(id: number, caseId: number, portal: boolean) {
  await api("/notifications/read", { method: "POST", body: JSON.stringify({ notification_id: id }) });
  refresh(); // the bell's count in the top bar
  redirect(`${portal ? "/portal/requests" : "/cases"}/${Math.trunc(Number(caseId))}`);
}

export async function readAll() {
  await api("/notifications/read", { method: "POST" });
  refresh();
}
