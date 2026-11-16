import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import type { CourierCatalogue } from "./types";

export const COURIER_CATALOGUE_KEY = ["courier-catalogue"] as const;

/**
 * The dzship courier catalogue, shared by every delivery screen.
 * The server answers at once from its saved copy; while it refreshes in the
 * background (`refreshing`), this hook re-reads every 2 s, then stops.
 */
export function useCourierCatalogue() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: COURIER_CATALOGUE_KEY,
    queryFn: async () => (await api.get<CourierCatalogue>("/deliveries/couriers/")).data,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (q) => (q.state.data?.refreshing ? 2000 : false),
  });

  /** Ask the server to fetch the catalogue again, then follow the refresh. */
  const forceRefresh = async () => {
    const data = (await api.get<CourierCatalogue>("/deliveries/couriers/", { params: { refresh: true } })).data;
    queryClient.setQueryData(COURIER_CATALOGUE_KEY, data);
  };

  return { ...query, forceRefresh };
}
