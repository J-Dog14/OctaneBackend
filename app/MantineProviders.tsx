"use client";

import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import { mantineTheme } from "@/lib/mantine-theme";

export function MantineProviders({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider theme={mantineTheme} defaultColorScheme="dark">
      {children}
    </MantineProvider>
  );
}
