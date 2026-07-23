import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export interface Wilaya {
  id: number;
  code: string;
  name: string;
  ar_name: string;
}

export interface Commune {
  id: number;
  wilaya: number;
  post_code: string;
  name: string;
  ar_name: string;
}

export function useWilayas() {
  return useQuery<Wilaya[]>({
    queryKey: ["wilayas"],
    queryFn: async () => {
      const res = await api.get("/core/wilayas/");
      return res.data;
    },
    staleTime: Infinity, // never stale
  });
}

export function useCommunes(wilayaId: number | string | null) {
  return useQuery<Commune[]>({
    queryKey: ["communes", wilayaId],
    queryFn: async () => {
      if (!wilayaId) return [];
      const res = await api.get(`/core/communes/?wilaya=${wilayaId}`);
      return res.data;
    },
    enabled: !!wilayaId,
    staleTime: Infinity,
  });
}
