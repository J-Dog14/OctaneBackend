import { createTheme, type MantineColorsTuple } from "@mantine/core";

// 10-stop scale derived from --accent: #2c99d4 (Octane Blue)
const octaneBlue: MantineColorsTuple = [
  "#e8f4fc",
  "#cce5f7",
  "#a6d2f1",
  "#79bceb",
  "#52a9e5",
  "#3aa8e8",
  "#2c99d4",
  "#2281b5",
  "#1a6a96",
  "#115378",
];

// 10-stop scale derived from --accent-secondary: #d62728 (Dusty Red)
const dustyRed: MantineColorsTuple = [
  "#fde8e8",
  "#fbc9c9",
  "#f7a0a0",
  "#f27474",
  "#ed4b4c",
  "#e03a3b",
  "#d62728",
  "#b51f20",
  "#951819",
  "#761213",
];

export const mantineTheme = createTheme({
  primaryColor: "octaneBlue",
  colors: { octaneBlue, dustyRed },
  fontFamily: '"DM Sans", system-ui, -apple-system, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", ui-monospace, monospace',
  defaultRadius: "sm",

  components: {
    AppShell: {
      styles: {
        header: {
          background: "var(--bg-secondary)",
          borderBottomColor: "var(--border)",
        },
        main: {
          background: "var(--bg-primary)",
        },
      },
    },

    Card: {
      defaultProps: { withBorder: true, radius: "md" },
      styles: {
        root: {
          background: "var(--bg-secondary)",
          borderColor: "var(--border)",
        },
      },
    },

    Tabs: {
      styles: {
        tab: {
          color: "var(--text-secondary)",
          fontWeight: "400" as const,
          "&[dataActive]": {
            color: "var(--accent)",
            borderColor: "var(--accent)",
            fontWeight: "600" as const,
          },
        },
        list: {
          borderColor: "var(--border)",
        },
      },
    },

    Select: {
      styles: {
        input: {
          background: "var(--bg-tertiary)",
          borderColor: "var(--border)",
          color: "var(--text-primary)",
        },
        dropdown: {
          background: "var(--bg-elevated)",
          borderColor: "var(--border)",
        },
        option: {
          color: "var(--text-primary)",
        },
      },
    },

    TextInput: {
      styles: {
        input: {
          background: "var(--bg-tertiary)",
          borderColor: "var(--border)",
          color: "var(--text-primary)",
        },
      },
    },

    SegmentedControl: {
      styles: {
        root: {
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border)",
        },
        label: {
          color: "var(--text-secondary)",
        },
        indicator: {
          background: "var(--bg-elevated)",
        },
      },
    },

    Badge: {
      styles: {
        root: {
          textTransform: "none" as const,
          fontWeight: 500,
        },
      },
    },

    Button: {
      styles: {
        root: {
          fontWeight: 500,
        },
      },
    },

    Checkbox: {
      styles: {
        label: {
          color: "var(--text-secondary)",
        },
      },
    },
  },
});
