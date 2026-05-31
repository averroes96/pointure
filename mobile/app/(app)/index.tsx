import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import KpiCard from "@/components/KpiCard";
import { COLORS } from "@/constants";
import api, { formatDZD } from "@/lib/api";
import { clearTokens } from "@/lib/auth";

interface MobileDashboard {
  today_revenue: string;
  sale_count_today: number;
  low_stock_count: number;
  cheques_due_soon: number;
  pending_purchase_orders: number;
  as_of: string;
}

export default function DashboardScreen() {
  const { data, isLoading, refetch, isRefetching } = useQuery<MobileDashboard>({
    queryKey: ["mobile", "dashboard"],
    queryFn: () => api.get("/mobile/dashboard/").then((r) => r.data),
  });

  async function handleLogout() {
    await clearTokens();
    router.replace("/(auth)/login");
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.primary} />
      }
    >
      <Text style={styles.date}>
        {data?.as_of
          ? new Date(data.as_of).toLocaleDateString("fr-DZ", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })
          : "Chargement..."}
      </Text>

      {/* Revenue + sales */}
      <View style={styles.row}>
        <KpiCard
          label="CA aujourd'hui"
          value={data ? `${formatDZD(data.today_revenue)} DZD` : "—"}
          accent="primary"
        />
        <KpiCard
          label="Ventes"
          value={data?.sale_count_today ?? "—"}
          sub="transactions"
          accent="primaryLight"
        />
      </View>

      {/* Alerts */}
      <View style={styles.row}>
        <KpiCard
          label="Stock bas"
          value={data?.low_stock_count ?? "—"}
          sub="références"
          accent={data && data.low_stock_count > 0 ? "warning" : "success"}
        />
        <KpiCard
          label="Chèques à venir"
          value={data?.cheques_due_soon ?? "—"}
          sub="dans 3 jours"
          accent={data && data.cheques_due_soon > 0 ? "danger" : "success"}
        />
      </View>

      <View style={styles.row}>
        <KpiCard
          label="BCs en attente"
          value={data?.pending_purchase_orders ?? "—"}
          sub="bons de commande"
          accent="textMuted"
        />
      </View>

      {/* Quick actions */}
      <Text style={styles.sectionTitle}>Accès rapide</Text>
      <View style={styles.actions}>
        <QuickAction
          label="Scanner un article"
          emoji="📷"
          onPress={() => router.push("/(app)/scan")}
        />
        <QuickAction
          label="Articles en alerte"
          emoji="📦"
          onPress={() => router.push("/(app)/inventory/")}
        />
      </View>

      <Pressable style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </Pressable>
    </ScrollView>
  );
}

function QuickAction({
  label,
  emoji,
  onPress,
}: {
  label: string;
  emoji: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.action} onPress={onPress}>
      <Text style={styles.actionEmoji}>{emoji}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.surface },
  container: { padding: 16, paddingBottom: 32 },
  date: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: 12,
    textTransform: "capitalize",
  },
  row: { flexDirection: "row", marginBottom: 4 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.text,
    marginTop: 20,
    marginBottom: 10,
  },
  actions: { flexDirection: "row", gap: 8 },
  action: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    shadowColor: COLORS.black,
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  actionEmoji: { fontSize: 28, marginBottom: 8 },
  actionLabel: { fontSize: 13, fontWeight: "600", color: COLORS.text, textAlign: "center" },
  logoutBtn: { marginTop: 32, alignItems: "center" },
  logoutText: { color: COLORS.textMuted, fontSize: 14 },
});
