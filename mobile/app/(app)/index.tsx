import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import KpiCard from "@/components/KpiCard";
import { C } from "@/constants";
import api, { formatDZD } from "@/lib/api";
import { clearTokens } from "@/lib/auth";

interface MobileDashboard {
  today_revenue?: string;       // omitted for cashiers
  sale_count_today?: number;    // omitted for cashiers
  low_stock_count: number;
  cheques_due_soon: number;
  pending_purchase_orders: number;
  as_of: string;
}

const QUICK_ACTIONS = [
  {
    label: "Scanner",
    sub: "Identifier un article",
    icon: "barcode-outline" as const,
    color: C.primary,
    bg: C.primaryBg,
    route: "/(app)/scan" as const,
  },
  {
    label: "Stock bas",
    sub: "Articles en alerte",
    icon: "cube-outline" as const,
    color: C.warning,
    bg: C.warningBg,
    route: "/(app)/inventory/" as const,
  },
];

export default function DashboardScreen() {
  const { data, isLoading, refetch, isRefetching } = useQuery<MobileDashboard>({
    queryKey: ["mobile", "dashboard"],
    queryFn: () => api.get("/mobile/dashboard/").then((r) => r.data),
  });

  const today = data?.as_of
    ? new Date(data.as_of).toLocaleDateString("fr-DZ", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "";

  async function handleLogout() {
    await clearTokens();
    router.replace("/(auth)/login");
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={C.primary}
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Bonjour 👋</Text>
          <Text style={styles.date}>{today}</Text>
        </View>
        <Pressable style={styles.logoutIcon} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color={C.textMuted} />
        </Pressable>
      </View>

      {/* Revenue highlight — managers and owners only */}
      {data?.today_revenue !== undefined && (
        <View style={styles.revenueCard}>
          <View style={styles.revenueLeft}>
            <Text style={styles.revenueLabel}>CA AUJOURD'HUI</Text>
            <Text style={styles.revenueValue}>
              {data?.today_revenue != null ? formatDZD(data.today_revenue) : "—"}
            </Text>
            <Text style={styles.revenueSub}>DZD</Text>
          </View>
          <View style={styles.revenueRight}>
            <View style={styles.salesBubble}>
              <Text style={styles.salesNum}>{data?.sale_count_today ?? "—"}</Text>
              <Text style={styles.salesLabel}>ventes</Text>
            </View>
          </View>
        </View>
      )}

      {/* KPI grid */}
      <Text style={styles.sectionTitle}>Alertes</Text>
      <View style={styles.kpiGrid}>
        <KpiCard
          label="Stock bas"
          value={data?.low_stock_count ?? "—"}
          sub="références"
          accent={data && data.low_stock_count > 0 ? "warning" : "success"}
          icon={
            <Ionicons
              name="cube-outline"
              size={16}
              color={data && data.low_stock_count > 0 ? C.warning : C.success}
            />
          }
        />
        <KpiCard
          label="Chèques dus"
          value={data?.cheques_due_soon ?? "—"}
          sub="dans 3 jours"
          accent={data && data.cheques_due_soon > 0 ? "danger" : "success"}
          icon={
            <Ionicons
              name="document-text-outline"
              size={16}
              color={data && data.cheques_due_soon > 0 ? C.danger : C.success}
            />
          }
        />
      </View>
      <View style={styles.kpiGrid}>
        <KpiCard
          label="BCs en attente"
          value={data?.pending_purchase_orders ?? "—"}
          sub="bons de commande"
          accent="neutral"
          fullWidth
          icon={
            <Ionicons name="cart-outline" size={16} color={C.textSecondary} />
          }
        />
      </View>

      {/* Quick actions */}
      <Text style={styles.sectionTitle}>Accès rapide</Text>
      <View style={styles.actionsRow}>
        {QUICK_ACTIONS.map((action) => (
          <Pressable
            key={action.label}
            style={styles.actionCard}
            onPress={() => router.push(action.route)}
          >
            <View style={[styles.actionIcon, { backgroundColor: action.bg }]}>
              <Ionicons name={action.icon} size={24} color={action.color} />
            </View>
            <Text style={styles.actionLabel}>{action.label}</Text>
            <Text style={styles.actionSub}>{action.sub}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: C.surface },
  container: { padding: C.space.lg, paddingBottom: 40 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: C.space.lg,
  },
  greeting: { fontSize: 22, fontWeight: "800", color: C.text, letterSpacing: -0.3 },
  date: { fontSize: 13, color: C.textMuted, marginTop: 2, textTransform: "capitalize", fontWeight: "500" },
  logoutIcon: {
    width: 36,
    height: 36,
    borderRadius: C.radius.full,
    backgroundColor: C.surfaceAlt,
    justifyContent: "center",
    alignItems: "center",
  },
  revenueCard: {
    backgroundColor: C.primary,
    borderRadius: C.radius.xl,
    padding: C.space.xxl,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: C.space.xl,
    ...C.shadow.md,
  },
  revenueLeft: {},
  revenueLabel: { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.7)", letterSpacing: 0.8 },
  revenueValue: { fontSize: 36, fontWeight: "800", color: C.white, letterSpacing: -1, marginTop: 4 },
  revenueSub: { fontSize: 13, color: "rgba(255,255,255,0.6)", fontWeight: "600" },
  revenueRight: {},
  salesBubble: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: C.radius.lg,
    padding: C.space.lg,
    alignItems: "center",
    minWidth: 72,
  },
  salesNum: { fontSize: 28, fontWeight: "800", color: C.white },
  salesLabel: { fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: "600", marginTop: 2 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: C.textSecondary,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: C.space.sm,
    marginTop: C.space.md,
  },
  kpiGrid: { flexDirection: "row", marginBottom: C.space.xs },
  actionsRow: { flexDirection: "row", gap: C.space.sm },
  actionCard: {
    flex: 1,
    backgroundColor: C.white,
    borderRadius: C.radius.lg,
    padding: C.space.lg,
    ...C.shadow.sm,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: C.radius.md,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: C.space.md,
  },
  actionLabel: { fontSize: 14, fontWeight: "700", color: C.text },
  actionSub: { fontSize: 12, color: C.textMuted, marginTop: 2, fontWeight: "500" },
});
