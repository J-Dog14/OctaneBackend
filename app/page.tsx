import { redirect } from "next/navigation";
import { getRole, homeFor } from "@/lib/auth/role";

export default async function Home() {
  redirect(homeFor(await getRole()));
}
