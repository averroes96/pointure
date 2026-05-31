import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { COLORS } from "@/constants";
import api from "@/lib/api";

interface Variant {
  id: number;
  product_name: string;
  size_eu: string;
  colour: string;
  stock_qty: number;
  alert_threshold: number;
  is_low_stock: boolean;
}

export default function LowStockScreen() {
  const { data, isLoading, refetch, isRefetching } = useQuery<{ results: Variant[] }>({
    queryKey: ["mobile", "low-stock"],
    queryFn: () => api.get("/inventory/low-stock/?page_size=100").then((r) => r.data),
  });

  const variants = data?.results ?? [];
  const outOfStock = variants.filter((v) => v.stock_qty === 0);
  const lowStock = variants.filter((v) => v.stock_qty > 0);

  return (
    <FlatList
      style={styles.list}
      data={variants}
      keyExtractor={(item) => String(item.id)}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.primary} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.stats}>
            <View style={[styles.stat, styles.statDanger]}>
              <Text style={styles.statNum}>{outOfStock.length}</Text>
              <Text style={styles.statLabel}>Ruptures</Text>
            </View>
            <View style={[styles.stat, styles.statWarn]}>
              <Text style={styles.statNum}>{lowStock.length}</Text>
              <Text style={styles.statLabel}>Stock bas</Text>
            </View>
          </View>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {isLoading ? "Chargement..." : "✅ Aucun article en alerte"}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          style={styles.item}
          onPress={() => router.push(`/(app)/inventory/${item.id}`)}
        >
          <View style={styles.itemLeft}>
            <Text style={styles.itemName}>{item.product_name}</Text>
            <Text style={styles.itemSub}>
              {item.size_eu} · {item.colour || "—"}
            </Text>
          </View>
          <View style={styles.itemRight}>
            <Text
              style={[
                styles.qty,
                item.stock_qty === 0 ? styles.qtyDanger : styles.qtyWarn,
              ]}
            >
              {item.stock_qty}
            </Text>
            <Text style={styles.threshold}>/ {item.alert_threshold}</Text>
          </View>
        </Pressable>
      )}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: COLORS.surface },
  header: { padding: 16 },
  stats: { flexDirection: "row", gap: 10 },
  stat: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  statDanger: { backgroundColor: COLORS.dangerBg },
  statWarn: { backgroundColor: COLORS.warningBg },
  statNum: { fontSize: 28, fontWeight: "700", color: COLORS.text },
  statLabel: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  item: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.white,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  itemLeft: { flex: 1 },
  itemName: { fontSize: 15, fontWeight: "600", color: COLORS.text },
  itemSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  itemRight: { flexDirection: "row", alignItems: "baseline", gap: 2 },
  qty: { fontSize: 22, fontWeight: "700" },
  qtyDanger: { color: COLORS.danger },
  qtyWarn: { color: COLORS.warning },
  threshold: { fontSize: 12, color: COLORS.textMuted },
  sep: { height: 1, backgroundColor: COLORS.border, marginLeft: 16 },
  empty: { padding: 48, alignItems: "center" },
  emptyText: { color: COLORS.textMuted, fontSize: 15 },
});
