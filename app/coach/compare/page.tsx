import { redirect } from "next/navigation";

const UUID_RE = /^[A-Za-z0-9-]{1,64}$/;

/** Old entry point. Compare now lives on the athlete page (?tab=compare&vs=…). */
export default async function CoachComparePage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const { ids } = await searchParams;
  const list = [...new Set((ids ?? "").split(",").map((s) => s.trim()).filter((s) => UUID_RE.test(s)))];
  if (!list.length) redirect("/coach");
  const [first, ...rest] = list;
  redirect(rest.length ? `/coach/athletes/${first}?tab=compare&vs=${rest.slice(0, 3).join(",")}` : `/coach/athletes/${first}`);
}
