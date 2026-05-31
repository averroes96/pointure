import { StyleSheet, Text, View } from "react-native";
import { C } from "@/constants";

type Accent = "primary" | "success" | "warning" | "danger" | "neutral";

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: Accent;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

const ACCENT_STYLES: Record<Accent, { bg: string; value: string; dot: string }> = {
  primary: { bg: C.primaryBg, value: C.primary, dot: C.primaryLight },
  success: { bg: C.successBg, value: C.success, dot: C.success },
  warning: { bg: C.warningBg, value: C.warning, dot: C.warning },
  danger: { bg: C.dangerBg, value: C.danger, dot: C.danger },
  neutral: { bg: C.surfaceAlt, value: C.textSecondary, dot: C.textMuted },
};

export default function KpiCard({
  label,
  value,
  sub,
  accent = "neutral",
  icon,
  fullWidth = false,
}: KpiCardProps) {
  const a = ACCENT_STYLES[accent];
  return (
    <View style={[styles.card, fullWidth && styles.fullWidth]}>
      <View style={styles.top}>
        <Text style={styles.label}>{label.toUpperCase()}</Text>
        {icon ? (
          <View style={[styles.iconWrap, { backgroundColor: a.bg }]}>{icon}</View>
        ) : null}
      </View>
      <Text style={[styles.value, { color: a.value }]}>{value}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: C.white,
    borderRadius: C.radius.lg,
    padding: C.space.xl,
    margin: C.space.xs,
    ...C.shadow.sm,
  },
  fullWidth: { flex: undefined, marginHorizontal: C.space.xs },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: C.space.sm,
  },
  label: {
    fontSize: 10,
    fontWeight: "700",
    color: C.textMuted,
    letterSpacing: 0.8,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: C.radius.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  value: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: C.text,
  },
  sub: {
    fontSize: 12,
    color: C.textMuted,
    marginTop: C.space.xs,
    fontWeight: "500",
  },
});
