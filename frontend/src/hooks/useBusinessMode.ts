import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type { BusinessMode, StoreSettings } from "@/types";
import { usePlan } from "./usePlan";

export interface UseBusinessModeReturn {
  mode: BusinessMode;
  isRetailOnly: boolean;
  isWholesaleOnly: boolean;
  isMixed: boolean;
  showWholesaleUI: boolean;
  showRetailPOS: boolean;
  settings?: StoreSettings;
  isLoading: boolean;
}

export function useBusinessMode(): UseBusinessModeReturn {
  const { canAccess } = usePlan();

  const { data: settings, isLoading } = useQuery<StoreSettings>({
    queryKey: ["store-settings"],
    queryFn: () => api.get("/core/store-settings/current/").then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const rawMode: BusinessMode = settings?.business_mode ?? "mixed";
  const hasWholesaleTier = canAccess("pro_wholesale");

  // If the account's plan tier doesn't include wholesale, clamp to retail
  const effectiveMode: BusinessMode = !hasWholesaleTier && rawMode !== "retail"
    ? "retail"
    : rawMode;

  const isRetailOnly = effectiveMode === "retail";
  const isWholesaleOnly = hasWholesaleTier && effectiveMode === "wholesale";
  const isMixed = hasWholesaleTier && effectiveMode === "mixed";

  return {
    mode: effectiveMode,
    isRetailOnly,
    isWholesaleOnly,
    isMixed,
    showWholesaleUI: hasWholesaleTier && effectiveMode !== "retail",
    showRetailPOS: effectiveMode !== "wholesale",
    settings,
    isLoading,
  };
}

