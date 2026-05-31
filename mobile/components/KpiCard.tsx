import { StyleSheet, Text, View } from "react-native";
import { COLORS } from "@/constants";

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: keyof typeof COLORS;
}

export default function KpiCard({ label, value, sub, accent = "primary" }: KpiCardProps) {
  const accentColor = COLORS[accent] as string;
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color: accentColor }]}>{value}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    margin: 4,
    shadowColor: COLORS.black,
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  label: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  value: {
    fontSize: 24,
    fontWeight: "700",
  },
  sub: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
});
