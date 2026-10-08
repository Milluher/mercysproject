"use client";

import { useRouter } from "next/navigation";

export function CompanyPicker({ companies, current }: { companies: { id: number; name: string }[]; current: number }) {
  const router = useRouter();
  return (
    <div className="max-w-sm">
      <label className="label" htmlFor="company-picker">
        Company
      </label>
      <select id="company-picker" className="input" value={current} onChange={(e) => router.push(`/company/${e.target.value}`)}>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
