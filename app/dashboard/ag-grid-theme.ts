import { themeQuartz, colorSchemeDark } from "ag-grid-community";

export const octaneTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  // Backgrounds
  backgroundColor: "#1a2332",
  headerBackgroundColor: "#243044",
  oddRowBackgroundColor: "#1a2332",
  // Text
  foregroundColor: "#e6edf3",
  headerTextColor: "#8b949e",
  // Borders
  borderColor: "#30363d",
  columnBorder: false,
  // Interaction
  rowHoverColor: "#243044",
  selectedRowBackgroundColor: "rgba(44, 153, 212, 0.2)",
  rangeSelectionBorderColor: "#2c99d4",
  inputFocusBorder: { color: "#2c99d4", width: 1, style: "solid" },
  // Typography
  fontFamily: '"DM Sans", system-ui, -apple-system, sans-serif',
  fontSize: 13,
  headerFontSize: 11,
  headerFontWeight: 600,
  // Layout
  cellHorizontalPadding: 12,
  wrapperBorderRadius: 10,
  rowHeight: 40,
  headerHeight: 38,
});
