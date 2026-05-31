import { useQuery, useQueryClient } from "@tanstack/react-query";
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

interface AppNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

const TYPE_EMOJI: Record<string, string> = {
  low_stock: "📦",
  cheque_due: "🏦",
  invoice_overdue: "📄",
  default: "🔔",
};

export default function NotificationsScreen() {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch, isRefetching } = useQuery<{ results: AppNotification[] }>({
    queryKey: ["notifications"],
    queryFn: () => api.get("/notifications/?page_size=50").then((r) => r.data),
  });

  const notifications = data?.results ?? [];
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  async function markAllRead() {
    try {
      await api.post("/notifications/mark-all-read/");
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    } catch {}
  }

  async function markRead(id: number) {
    try {
      await api.post(`/notifications/${id}/read/`);
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    } catch {}
  }

  return (
    <FlatList
      style={styles.list}
      data={notifications}
      keyExtractor={(item) => String(item.id)}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.primary} />
      }
      ListHeaderComponent={
        unreadCount > 0 ? (
          <Pressable style={styles.markAll} onPress={markAllRead}>
            <Text style={styles.markAllText}>Tout marquer comme lu ({unreadCount})</Text>
          </Pressable>
        ) : null
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {isLoading ? "Chargement..." : "Aucune notification"}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          style={[styles.item, !item.is_read && styles.itemUnread]}
          onPress={() => !item.is_read && markRead(item.id)}
        >
          <Text style={styles.emoji}>{TYPE_EMOJI[item.type] ?? TYPE_EMOJI.default}</Text>
          <View style={styles.itemBody}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text style={styles.itemSub}>{item.body}</Text>
            <Text style={styles.itemDate}>
              {new Date(item.created_at).toLocaleDateString("fr-DZ", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          </View>
          {!item.is_read && <View style={styles.dot} />}
        </Pressable>
      )}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: COLORS.surface },
  markAll: {
    padding: 14,
    alignItems: "center",
    backgroundColor: COLORS.primaryBg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  markAllText: { color: COLORS.primary, fontWeight: "600", fontSize: 14 },
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: COLORS.white,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  itemUnread: { backgroundColor: COLORS.primaryBg },
  emoji: { fontSize: 22, marginTop: 2 },
  itemBody: { flex: 1 },
  itemTitle: { fontSize: 14, fontWeight: "600", color: COLORS.text },
  itemSub: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  itemDate: { fontSize: 11, color: COLORS.textMuted, marginTop: 4 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginTop: 6,
  },
  sep: { height: 1, backgroundColor: COLORS.border },
  empty: { padding: 48, alignItems: "center" },
  emptyText: { color: COLORS.textMuted, fontSize: 15 },
});
