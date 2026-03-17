import "./globals.css";
import { ColorSchemeScript } from "@mantine/core";
import { MantineProviders } from "./MantineProviders";

export const metadata = {
  title: "Octane Biomech",
  description: "Biomechanics data dashboard and payload management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

