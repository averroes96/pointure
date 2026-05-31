import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { COLORS } from "@/constants";
import api, { formatDZD } from "@/lib/api";

const REASONS = [
  { value: "received", label: "Réception marchandise" },
  { value: "adjustment", label: "Ajustement inventaire" },
  { value: "damaged", label: "Article endommagé" },
  { value: "returned", label: "Retour client" },
];

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: scanData, isLoading } = useQuery({
    queryKey: ["mobile", "variant", id],
    queryFn: () =>
      api.get(`/inventory/variants/${id}/`).then((r) => r.data),
  });

  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("adjustment");
  const [saving, setSaving] = useState(false);

  async function handleAdjust() {
    const num = parseInt(delta, 10);
    if (isNaN(num) || num === 0) {
      Alert.alert("Valeur invalide", "Saisissez un nombre différent de zéro (négatif pour retirer).");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/inventory/variants/${id}/adjust/`, {
        delta: num,
        reason,
      });
      setDelta("");
      await queryClient.invalidateQueries({ queryKey: ["mobile", "variant", id] });
      await queryClient.invalidateQueries({ queryKey: ["mobile", "low-stock"] });
      await queryClient.invalidateQueries({ queryKey: ["mobile", "dashboard"] });
      Alert.alert("Stock ajusté", `${num > 0 ? "+" : ""}${num} unité(s) enregistrée(s).`);
    } catch (err: any) {
      Alert.alert("Erreur", err?.response?.data?.detail ?? "Impossible d'ajuster le stock.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!scanData) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Article introuvable.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Product info */}
        <View style={styles.card}>
          <Text style={styles.name}>{scanData.product_name}</Text>
          <Text style={styles.sub}>
            Pointure {scanData.size_eu}
            {scanData.colour ? ` · ${scanData.colour}` : ""}
          </Text>
          {scanData.barcode ? (
            <Text style={styles.barcode}>#{scanData.barcode}</Text>
          ) : null}
        </View>

        {/* Current stock */}
        <View
          style={[
            styles.stockCard,
            scanData.stock_qty === 0 && styles.stockCardDanger,
            scanData.is_low_stock && scanData.stock_qty > 0 && styles.stockCardWarn,
          ]}
        >
          <Text style={styles.stockQty}>{scanData.stock_qty}</Text>
          <Text style={styles.stockLabel}>
            {scanData.stock_qty === 0
              ? "Rupture de stock"
              : scanData.is_low_stock
              ? `Stock bas (seuil : ${scanData.alert_threshold})`
              : "unités en stock"}
          </Text>
        </View>

        {/* Adjustment form */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ajuster le stock</Text>

          <Text style={styles.label}>Quantité (+/-)</Text>
          <TextInput
            style={styles.input}
            value={delta}
            onChangeText={setDelta}
            keyboardType="numbers-and-punctuation"
            placeholder="+10 ou -3"
            placeholderTextColor={COLORS.textMuted}
          />

          <Text style={styles.label}>Motif</Text>
          <View style={styles.reasons}>
            {REASONS.map((r) => (
              <Pressable
                key={r.value}
                style={[styles.reasonChip, reason === r.value && styles.reasonChipActive]}
                onPress={() => setReason(r.value)}
              >
                <Text
                  style={[
                    styles.reasonText,
                    reason === r.value && styles.reasonTextActive,
                  ]}
                >
                  {r.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={[styles.btn, saving && styles.btnDisabled]}
            onPress={handleAdjust}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.btnText}>Enregistrer l'ajustement</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.surface },
  content: { padding: 16, gap: 12 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    shadowColor: COLORS.black,
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  name: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  sub: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },
  barcode: { fontSize: 12, color: COLORS.textMuted, marginTop: 4, fontFamily: "monospace" },
  stockCard: {
    backgroundColor: COLORS.successBg,
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
  },
  stockCardWarn: { backgroundColor: COLORS.warningBg },
  stockCardDanger: { backgroundColor: COLORS.dangerBg },
  stockQty: { fontSize: 48, fontWeight: "700", color: COLORS.text },
  stockLabel: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: COLORS.text, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: "600", color: COLORS.text, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 16,
  },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  reasonChip: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: COLORS.surface,
  },
  reasonChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryBg },
  reasonText: { fontSize: 12, color: COLORS.textMuted },
  reasonTextActive: { color: COLORS.primary, fontWeight: "600" },
  btn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: COLORS.white, fontWeight: "700", fontSize: 15 },
  errorText: { color: COLORS.danger, fontSize: 15 },
});
