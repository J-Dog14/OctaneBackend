import "./globals.css";
import { ColorSchemeScript } from "@mantine/core";
import { MantineProviders } from "./MantineProviders";
import { ClerkProvider } from "@clerk/nextjs";

export const metadata = {
  title: "Octane Biomech",
  description: "Biomechanics data dashboard and payload management",
};

const clerkAppearance = {
  variables: {
    colorPrimary: "#2c99d4",
    colorBackground: "#111827",
    colorInputBackground: "#1f2937",
    colorText: "#f9fafb",
    colorTextSecondary: "#9ca3af",
    borderRadius: "6px",
  },
};

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ColorSchemeScript defaultColorScheme="dark" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <MantineProviders>{children}</MantineProviders>
      </body>
    </html>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <Layout>{children}</Layout>;
  }

  return (
    <ClerkProvider appearance={clerkAppearance} afterSignOutUrl="/sign-in">
      <Layout>{children}</Layout>
    </ClerkProvider>
  );
}
