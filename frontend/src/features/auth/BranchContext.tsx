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
import { useAuth } from "./AuthContext";
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

/**
 * The branch to start with: the one saved from last time, else the headquarters, else the first.
 *
 * Branch ids are UUID strings. The saved id used to be compared after parseInt(), which never matched
 * a UUID, so the saved choice was ignored and every restart fell back to the headquarters.
 */
export function pickInitialBranch(list: Branch[], savedId: string | null): Branch | null {
  const saved = savedId ? list.find((b) => String(b.id) === savedId) : undefined;
  return saved ?? list.find((b) => b.is_headquarters) ?? list[0] ?? null;
}

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranchState] = useState<Branch | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setBranches([]);
      setCurrentBranchState(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    api
      .get<{ results: Branch[] }>("/core/branches/?is_active=true&page_size=100")
      .then((r) => {
        const list: Branch[] = r.data.results ?? (r.data as unknown as Branch[]);
        setBranches(list);

        if (list.length === 0) return;

        setCurrentBranchState(pickInitialBranch(list, localStorage.getItem(STORAGE_KEY)));
      })
      .catch(() => {
        // No branches or network error — continue without branch context
      })
      .finally(() => setIsLoading(false));
  }, [isAuthenticated]);

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
