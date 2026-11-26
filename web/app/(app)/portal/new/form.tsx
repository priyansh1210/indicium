"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/public-shell";
import type { ActionState } from "@/lib/attempt";
import { keepForm } from "@/lib/keep-form";

import { submitRequest } from "../actions";
import { DocumentFields } from "../documents";

function Section({ title, about, children }: { title: string; about: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-rule py-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,8fr)] lg:gap-12">
      <div>
        <h2 className="font-serif text-[22px] font-semibold">{title}</h2>
        <p className="mt-1 max-w-[36ch] text-[14px] text-ink-2">{about}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function RequestForm({ externalId, services }: { externalId: string; services: { code: string; title: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(submitRequest.bind(null, externalId), {
    error: null,
  });
  return (
    <form onSubmit={keepForm(action)} aria-label="New request">
      <Section title="Patient" about="As on the member card. Synthetic data only in this environment.">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">Member ID</span>
            <input name="member_id" required minLength={3} maxLength={64} autoComplete="off" className="field code" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">Full name</span>
            <input name="patient_name" required maxLength={200} autoComplete="off" className="field" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">Date of birth</span>
            <input name="birth_date" type="date" required className="field" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">Sex</span>
            <select name="sex" defaultValue="unknown" className="field h-[43px]">
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
              <option value="unknown">Not stated</option>
            </select>
          </label>
        </div>
      </Section>

      <Section title="Service" about="The procedure ordered and the diagnoses that support it.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold">Procedure code (CPT or HCPCS)</span>
              <input name="procedure_code" required list="services" maxLength={10} autoComplete="off" className="field code" aria-describedby="code-help" />
              <datalist id="services">
                {services.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.title}
                  </option>
                ))}
              </datalist>
            </label>
            <p id="code-help" className="text-[13px] text-ink-2">
              Start typing: codes with a coverage policy here are suggested.
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold">Diagnosis codes (ICD-10)</span>
              <input aria-describedby="diagnosis-help" name="diagnosis_codes" required maxLength={300} autoComplete="off" placeholder="M54.16, M51.26" className="field code" />
            </label>
            <p id="diagnosis-help" className="text-[13px] text-ink-2">Separate with commas or spaces.</p>
          </div>
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-sm font-semibold">Ordering clinician</span>
            <input name="requested_by" required maxLength={200} placeholder="e.g. Dr. Maya Chen, orthopedic surgery" className="field" />
          </label>
        </div>
        <fieldset className="mt-5">
          <legend className="text-sm font-semibold">How soon</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {[
              ["standard", "Standard", "A decision within 7 calendar days."],
              ["expedited", "Expedited", "Within 72 hours. Only when waiting could seriously harm the patient's health."],
            ].map(([value, label, help]) => (
              <label key={value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-rule bg-paper p-3 has-checked:border-accent has-checked:bg-accent-soft">
                <input type="radio" name="urgency" value={value} defaultChecked={value === "standard"} className="mt-[5px] shrink-0 accent-[var(--color-accent)]" />
                <span>
                  <span className="block font-semibold">{label}</span>
                  <span className="block text-[13px] text-ink-2">{help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </Section>

      <Section
        title="Clinical notes"
        about="Office notes, imaging reports, therapy notes. Text only: paste it, or load a .txt export from your EHR."
      >
        <DocumentFields />
      </Section>

      <div className="sticky bottom-0 -mx-4 space-y-3 border-t border-rule bg-canvas px-4 py-4 sm:mx-0 sm:px-0">
        <FormMessage error={state.error} />
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={pending} className="btn btn-primary">
            {pending ? "Sending…" : "Send request"}
          </button>
          <p className="text-[13px] text-ink-2">A request without notes is accepted, and pended until notes arrive.</p>
        </div>
      </div>
    </form>
  );
}
