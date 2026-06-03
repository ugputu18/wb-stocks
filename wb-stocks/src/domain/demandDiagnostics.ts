export const CENSORED_PEAK_DEMAND_MODEL_VERSION = "censored-peak-v1";
export const LEGACY_DEMAND_MODEL_VERSION = "legacy-v1";

export interface DemandDiagnosticsFields {
  demandModelVersion?: string;
  rawAvgDaily7?: number;
  rawAvgDaily30?: number;
  rawAvgDaily90?: number;
  adjustedAvgDaily7?: number;
  adjustedAvgDaily30?: number;
  adjustedAvgDaily90?: number;
  sellableDays7?: number;
  sellableDays30?: number;
  sellableDays90?: number;
  constrainedDays7?: number;
  constrainedDays30?: number;
  constrainedDays90?: number;
  availabilityObservedDays7?: number;
  availabilityObservedDays30?: number;
  availabilityObservedDays90?: number;
  peakDailyDemand?: number;
  forecastAllocationScale?: number;
}
