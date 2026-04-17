export type AthleteOption = { value: string; label: string };

export type VarSelector = {
  table: string;
  variable: string;
  groups: string[];
  exerciseName?: string;
};

export const DEFAULT_VAR: VarSelector = { table: "", variable: "", groups: [] };
