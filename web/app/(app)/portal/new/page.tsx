import type { Metadata } from "next";

import { api } from "@/lib/api";

import { RequestForm } from "./form";

export const metadata: Metadata = { title: "New request" };

export default async function NewRequestPage() {
  const services = await api<{ code: string; title: string }[]>("/portal/services");
  return (
    <div className="max-w-[1080px] space-y-8">
      <div className="rise">
        <h1 className="title">New request</h1>
        <p className="mt-2 max-w-[68ch] text-ink-2">
          The order, the diagnoses behind it, and the notes that show the coverage criteria are met. Reviewers read the
          notes against the published policy for the service, so the more of the record you send, the fewer questions
          come back.
        </p>
      </div>
      <RequestForm externalId={`portal-${crypto.randomUUID()}`} services={services} />
    </div>
  );
}
