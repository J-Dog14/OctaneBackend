import { AppShell, AppShellHeader, AppShellMain } from "@mantine/core";
import { CoachGuard } from "./CoachGuard";
import { CoachHeader } from "./CoachHeader";

export const metadata = {
  title: "8ctane Coach",
  description: "Everything about an athlete in one place: pitch data, biomechanics, assessments, readiness and Proteus.",
};

/** Coach suite shell. Separate from /dashboard so coaches never see backend tools. */
export default function CoachLayout({ children }: { children: React.ReactNode }) {
  return (
    <CoachGuard>
      <AppShell header={{ height: 56 }} padding="lg">
        <AppShellHeader style={{ borderBottom: "1px solid var(--border)" }}>
          <CoachHeader />
        </AppShellHeader>
        <AppShellMain>{children}</AppShellMain>
      </AppShell>
    </CoachGuard>
  );
}
