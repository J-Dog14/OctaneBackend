"use client";

import {
  Card,
  Text,
  Title,
  Grid,
  GridCol,
  Tooltip,
  Badge,
  Stack,
  Group,
  Divider,
} from "@mantine/core";
import type { StatisticsResult } from "@/lib/research/statistics";

type Props = {
  stats: StatisticsResult;
  xLabel: string;
  yLabel: string;
  trendlineMode: "linear" | "polynomial" | "none";
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sig(p: number | null): { color: string; label: string } {
  if (p === null) return { color: "gray", label: "N/A" };
  if (p < 0.001)  return { color: "green", label: "p < 0.001 (***)" };
  if (p < 0.01)   return { color: "green", label: "p < 0.01 (**)" };
  if (p < 0.05)   return { color: "teal",  label: "p < 0.05 (*)" };
  if (p < 0.10)   return { color: "yellow",label: "p < 0.10 (trend)" };
  return           { color: "red",   label: `p = ${p.toFixed(4)} (ns)` };
}

function corrStrength(r: number | null): string {
  if (r === null) return "";
  const a = Math.abs(r);
  if (a >= 0.90) return "Very strong";
  if (a >= 0.70) return "Strong";
  if (a >= 0.50) return "Moderate";
  if (a >= 0.30) return "Weak";
  return "Very weak / negligible";
}

function corrDirection(r: number | null): string {
  if (r === null || Math.abs(r) < 0.05) return "";
  return r > 0 ? "positive" : "negative";
}

function fmt(v: number | null, decimals = 3): string {
  if (v === null || !isFinite(v)) return "—";
  return v.toFixed(decimals);
}

// ─── Stat row component ───────────────────────────────────────────────────────

function StatRow({
  label,
  value,
  explanation,
  badge,
}: {
  label: string;
  value: string;
  explanation: string;
  badge?: React.ReactNode;
}) {
  return (
    <Tooltip
      label={explanation}
      multiline
      w={340}
      withArrow
      position="top-start"
      transitionProps={{ duration: 150 }}
    >
      <div style={{ cursor: "help", padding: "6px 0", borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c="dimmed" style={{ minWidth: 0 }}>
            {label}
          </Text>
          <Group gap="xs" wrap="nowrap">
            {badge}
            <Text size="sm" fw={600} style={{ whiteSpace: "nowrap" }}>
              {value}
            </Text>
          </Group>
        </Group>
      </div>
    </Tooltip>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StatisticsPanel({ stats, xLabel, yLabel, trendlineMode }: Props) {
  const { pearsonR, rSquared, pValue, ci95Low, ci95High, spearmanRho, spearmanP, regression, polyRegression, standardError, meanX, meanY, sdX, sdY, n } = stats;

  const pSig   = sig(pValue);
  const rhoSig = sig(spearmanP);
  const strength = corrStrength(pearsonR);
  const direction = corrDirection(pearsonR);

  const interpretationText = pearsonR !== null && n >= 3
    ? `${strength} ${direction} linear relationship. ${pValue !== null && pValue < 0.05 ? "Statistically significant." : "Not statistically significant at α=0.05."} ${rSquared !== null ? `${(rSquared * 100).toFixed(1)}% of variance in ${yLabel} is explained by ${xLabel}.` : ""}`
    : "Insufficient data (need ≥ 3 paired observations).";

  const regressionEq = trendlineMode === "polynomial" && polyRegression
    ? polyRegression.equation
    : regression?.equation ?? "—";

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Title order={5}>Statistical Analysis</Title>
        <Badge variant="light" color="blue">n = {n}</Badge>
      </Group>

      {/* Plain-language interpretation */}
      <Card p="sm" radius="sm" withBorder style={{ background: "var(--mantine-color-blue-light)" }}>
        <Text size="sm" c="blue.8">{interpretationText}</Text>
      </Card>

      <Grid gutter="md">
        {/* ── Column 1: Correlation ── */}
        <GridCol span={{ base: 12, sm: 6 }}>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>Correlation</Text>
          <StatRow
            label="Pearson r"
            value={fmt(pearsonR)}
            explanation="Pearson's product-moment correlation coefficient. Measures the strength and direction of the LINEAR relationship between two variables. Ranges from −1 (perfect negative) to +1 (perfect positive). Near 0 = no linear relationship."
            badge={pearsonR !== null ? (
              <Badge size="xs" variant="light" color={Math.abs(pearsonR) > 0.5 ? "green" : Math.abs(pearsonR) > 0.3 ? "yellow" : "gray"}>
                {strength}
              </Badge>
            ) : undefined}
          />
          <StatRow
            label="R² (coefficient of determination)"
            value={rSquared !== null ? `${fmt(rSquared)} (${(rSquared! * 100).toFixed(1)}%)` : "—"}
            explanation={`R-squared tells you what proportion of the variance in ${yLabel} is predictable from ${xLabel}. An R² of 0.64 means 64% of the variation in Y is explained by X. The remaining % is due to other factors.`}
          />
          <StatRow
            label="Spearman ρ (rho)"
            value={fmt(spearmanRho)}
            explanation="Spearman rank correlation. A NON-PARAMETRIC measure of monotonic relationship — it doesn't assume linearity or normal distribution. Useful when data is skewed or has outliers. Interpreted similarly to Pearson r."
          />
          <StatRow
            label="95% Confidence Interval for r"
            value={ci95Low !== null && ci95High !== null ? `[${fmt(ci95Low)}, ${fmt(ci95High)}]` : "—"}
            explanation="We are 95% confident the true population correlation coefficient falls within this range. A wide interval = low precision (small sample). Does NOT crossing zero means the correlation is significant."
          />
        </GridCol>

        {/* ── Column 2: Significance ── */}
        <GridCol span={{ base: 12, sm: 6 }}>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>Significance</Text>
          <StatRow
            label="p-value (Pearson)"
            value={pValue !== null ? (pValue < 0.0001 ? "< 0.0001" : pValue.toFixed(4)) : "—"}
            explanation="The probability of observing a correlation this large (or larger) by chance if the true correlation is zero. p < 0.05 is the conventional threshold for 'statistically significant.' Small p = strong evidence of a real relationship."
            badge={<Badge size="xs" variant="light" color={pSig.color}>{pSig.label}</Badge>}
          />
          <StatRow
            label="p-value (Spearman)"
            value={spearmanP !== null ? (spearmanP < 0.0001 ? "< 0.0001" : spearmanP.toFixed(4)) : "—"}
            explanation="Same as the Pearson p-value but for Spearman's rank correlation. Because Spearman doesn't assume normality, this is more trustworthy when your data isn't normally distributed."
            badge={<Badge size="xs" variant="light" color={rhoSig.color}>{rhoSig.label}</Badge>}
          />

          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4} mt="sm">Regression</Text>
          <StatRow
            label={trendlineMode === "polynomial" ? "Polynomial equation" : "Linear equation"}
            value={regressionEq}
            explanation="The best-fit line (or curve) through the data. For linear: slope tells you how much Y changes for each 1-unit increase in X. Intercept is the predicted Y when X = 0."
          />
          <StatRow
            label="Standard error of estimate"
            value={standardError !== null ? fmt(standardError) : "—"}
            explanation="The average distance that the observed values fall from the regression line (in the same units as Y). Smaller = tighter fit. Roughly 68% of data points fall within ±1 SEE of the line."
          />
        </GridCol>
      </Grid>

      <Divider />

      {/* ── Descriptive Statistics ── */}
      <Text size="xs" fw={700} tt="uppercase" c="dimmed">Descriptive Statistics</Text>
      <Grid gutter="md">
        <GridCol span={{ base: 12, sm: 6 }}>
          <Text size="xs" c="dimmed" mb={4}>{xLabel} (X)</Text>
          <StatRow
            label="Mean"
            value={fmt(meanX)}
            explanation={`Average value of ${xLabel} across all included data points.`}
          />
          <StatRow
            label="Std Dev"
            value={fmt(sdX)}
            explanation={`Standard deviation of ${xLabel}. Measures how spread out the values are. 68% of values typically fall within ±1 SD of the mean.`}
          />
        </GridCol>
        <GridCol span={{ base: 12, sm: 6 }}>
          <Text size="xs" c="dimmed" mb={4}>{yLabel} (Y)</Text>
          <StatRow
            label="Mean"
            value={fmt(meanY)}
            explanation={`Average value of ${yLabel} across all included data points.`}
          />
          <StatRow
            label="Std Dev"
            value={fmt(sdY)}
            explanation={`Standard deviation of ${yLabel}.`}
          />
        </GridCol>
      </Grid>

      <Text size="xs" c="dimmed" mt="xs">
        Hover any statistic row for an explanation. All tests are two-tailed.
        Significance threshold α = 0.05 (conventional).
      </Text>
    </Stack>
  );
}
