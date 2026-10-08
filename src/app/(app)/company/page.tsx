import { notFound, redirect } from "next/navigation";

import { isAdmin } from "@/lib/auth";
import { listCompanies } from "@/lib/data";
import { requireUser } from "@/lib/session";

/** "Company detail" in the nav: the first company for the fund team, your own for founders. */
export default async function CompanyIndex() {
  const user = await requireUser();
  if (!isAdmin(user)) redirect(`/company/${user.companyId}`);
  const [first] = await listCompanies();
  if (!first) notFound();
  redirect(`/company/${first.id}`);
}
