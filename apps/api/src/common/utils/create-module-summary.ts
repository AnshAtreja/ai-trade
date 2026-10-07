export interface ModuleSummary {
  key: string;
  title: string;
  description: string;
  status: string;
  metrics: Array<{
    label: string;
    value: string;
  }>;
}

