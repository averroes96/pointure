/**
 * BranchContext — active branch selection for multi-branch tenants.
 *
 * Fetches the list of active branches once on mount, restores the last
 * selection from localStorage, and auto-selects the HQ branch on first use.
 *
 * Usage:
 *   const { branches, currentBranch, setCurrentBranch } = useBranch();
 */
import { useTranslation } from "react-i18next";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import api from "@/lib/api";
import type { Branch } from "@/types";

const STORAGE_KEY = "selected_branch_id";

interface BranchContextValue {
  branches: Branch[];
  currentBranch: Branch | null;
  setCurrentBranch: (branch: Branch) => void;
  isLoading: boolean;
}

const BranchContext = createContext<BranchContextValue | null>(null);

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranchState] = useState<Branch | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ results: Branch[] }>("/core/branches/?is_active=true&page_size=100")
      .then((r) => {
        const list: Branch[] = r.data.results ?? (r.data as unknown as Branch[]);
        setBranches(list);

        if (list.length === 0) return;

        // Restore saved selection
        const savedId = localStorage.getItem(STORAGE_KEY);
        const saved = savedId
          ? list.find((b) => b.id === parseInt(savedId, 10)) ?? null
          : null;

        // Fall back to HQ branch, then first in list
        const hq = list.find((b) => b.is_headquarters) ?? list[0];
        setCurrentBranchState(saved ?? hq);
      })
      .catch(() => {
        // No branches or network error — continue without branch context
      })
      .finally(() => setIsLoading(false));
  }, []);

  const setCurrentBranch = useCallback((branch: Branch) => {
    setCurrentBranchState(branch);
    localStorage.setItem(STORAGE_KEY, String(branch.id));
  }, []);

  return (
    <BranchContext.Provider
      value={{ branches, currentBranch, setCurrentBranch, isLoading }}
    >
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch(): BranchContextValue {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
}
