import { Ionicons } from "@expo/vector-icons";
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
import { C } from "@/constants";
import api from "@/lib/api";

interface Variant {
  id: number;
  product_name: string;
  size_eu: string;
  colour: string;
  stock_qty: number;
  alert_threshold: number;
}

function StatPill({
  count,
  label,
  accent,
}: {
  count: number;
  label: string;
  accent: "danger" | "warning";
}) {
  const bg = accent === "danger" ? C.dangerBg : C.warningBg;
  const border = accent === "danger" ? C.dangerBorder : C.warningBorder;
  const color = accent === "danger" ? C.danger : C.warning;
  return (
    <View style={[styles.pill, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[styles.pillNum, { color }]}>{count}</Text>
      <Text style={[styles.pillLabel, { color }]}>{label}</Text>
    </View>
  );
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
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={C.primary}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {isLoading ? (
            <Text style={styles.loadingText}>Chargement...</Text>
          ) : (
            <View style={styles.pills}>
              <StatPill count={outOfStock.length} label="Ruptures" accent="danger" />
              <StatPill count={lowStock.length} label="Stock bas" accent="warning" />
            </View>
          )}
        </View>
      }
      ListEmptyComponent={
        !isLoading ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="checkmark-circle-outline" size={40} color={C.success} />
            </View>
            <Text style={styles.emptyTitle}>Tout est en ordre</Text>
            <Text style={styles.emptySub}>Aucun article sous le seuil d'alerte</Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        const isOut = item.stock_qty === 0;
        const pct = item.alert_threshold > 0
          ? Math.min((item.stock_qty / item.alert_threshold) * 100, 100)
          : 0;
        return (
          <Pressable
            style={styles.item}
            onPress={() => router.push(`/(app)/inventory/${item.id}`)}
          >
            <View style={[styles.statusBar, { backgroundColor: isOut ? C.danger : C.warning }]} />
            <View style={styles.itemBody}>
              <View style={styles.itemTop}>
                <Text style={styles.itemName} numberOfLines={1}>{item.product_name}</Text>
                <View style={[styles.qtyBadge, { backgroundColor: isOut ? C.dangerBg : C.warningBg }]}>
                  <Text style={[styles.qtyText, { color: isOut ? C.danger : C.warning }]}>
                    {item.stock_qty}
                  </Text>
                </View>
              </View>
              <Text style={styles.itemSub}>
                T.{item.size_eu}
                {item.colour ? ` · ${item.colour}` : ""}
                {" "}· Seuil : {item.alert_threshold}
              </Text>
              {/* Progress bar */}
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${pct}%`,
                      backgroundColor: isOut ? C.danger : C.warning,
                    },
                  ]}
                />
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
          </Pressable>
        );
      }}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      contentContainerStyle={variants.length === 0 ? { flex: 1 } : undefined}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: C.surface },
  header: { padding: C.space.lg, paddingBottom: C.space.sm },
  pills: { flexDirection: "row", gap: C.space.sm },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: C.radius.full,
    paddingHorizontal: C.space.md,
    paddingVertical: C.space.sm,
    borderWidth: 1,
    gap: C.space.xs,
  },
  pillNum: { fontSize: 16, fontWeight: "800" },
  pillLabel: { fontSize: 12, fontWeight: "600" },
  loadingText: { color: C.textMuted, fontSize: 14 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.white,
    paddingRight: C.space.lg,
  },
  statusBar: { width: 4, alignSelf: "stretch", borderRadius: 0 },
  itemBody: { flex: 1, paddingVertical: C.space.md, paddingHorizontal: C.space.lg },
  itemTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 },
  itemName: { flex: 1, fontSize: 14, fontWeight: "700", color: C.text, marginRight: C.space.sm },
  qtyBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: C.radius.full },
  qtyText: { fontSize: 14, fontWeight: "800" },
  itemSub: { fontSize: 12, color: C.textMuted, fontWeight: "500", marginBottom: 8 },
  progressTrack: { height: 4, backgroundColor: C.surfaceAlt, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  sep: { height: 1, backgroundColor: C.borderLight, marginLeft: C.space.lg },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", padding: 40 },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: C.successBg, justifyContent: "center", alignItems: "center", marginBottom: C.space.lg },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: C.text, marginBottom: 6 },
  emptySub: { fontSize: 14, color: C.textMuted, textAlign: "center", fontWeight: "500" },
});
