import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
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
import { C } from "@/constants";
import api, { formatDZD } from "@/lib/api";

const REASONS = [
  { value: "received", label: "Réception", icon: "arrow-down-circle-outline" as const },
  { value: "adjustment", label: "Inventaire", icon: "create-outline" as const },
  { value: "damaged", label: "Endommagé", icon: "alert-circle-outline" as const },
  { value: "returned", label: "Retour", icon: "return-up-back-outline" as const },
];

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["mobile", "variant", id],
    queryFn: () => api.get(`/inventory/variants/${id}/`).then((r) => r.data),
  });

  useEffect(() => {
    if (data?.product_name) navigation.setOptions({ title: data.product_name });
  }, [data?.product_name]);

  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("received");
  const [saving, setSaving] = useState(false);

  const parsedDelta = parseInt(delta, 10);
  const isPositive = parsedDelta > 0;
  const isValid = !isNaN(parsedDelta) && parsedDelta !== 0;

  async function handleAdjust() {
    if (!isValid) {
      Alert.alert("Valeur invalide", "Entrez un nombre non nul (+10 pour ajouter, -3 pour retirer).");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/inventory/variants/${id}/adjust/`, { delta: parsedDelta, reason });
      setDelta("");
      await queryClient.invalidateQueries({ queryKey: ["mobile", "variant", id] });
      await queryClient.invalidateQueries({ queryKey: ["mobile", "low-stock"] });
      await queryClient.invalidateQueries({ queryKey: ["mobile", "dashboard"] });
      Alert.alert(
        "Stock mis à jour",
        `${isPositive ? "+" : ""}${parsedDelta} unité${Math.abs(parsedDelta) > 1 ? "s" : ""} enregistrée${Math.abs(parsedDelta) > 1 ? "s" : ""}.`
      );
    } catch (err: any) {
      Alert.alert("Erreur", err?.response?.data?.detail ?? "Impossible d'ajuster le stock.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={40} color={C.danger} />
        <Text style={styles.errorText}>Article introuvable</Text>
      </View>
    );
  }

  const isOut = data.stock_qty === 0;
  const isLow = data.is_low_stock && !isOut;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* Product identity */}
        <View style={styles.identityCard}>
          <Text style={styles.variantName}>{data.product_name}</Text>
          <View style={styles.tagRow}>
            <View style={styles.tag}>
              <Text style={styles.tagText}>T.{data.size_eu}</Text>
            </View>
            {data.colour ? (
              <View style={styles.tag}>
                <Text style={styles.tagText}>{data.colour}</Text>
              </View>
            ) : null}
            {data.barcode ? (
              <View style={[styles.tag, styles.tagMono]}>
                <Ionicons name="barcode-outline" size={11} color={C.textMuted} />
                <Text style={[styles.tagText, { fontFamily: "monospace" }]}>{data.barcode}</Text>
              </View>
            ) : null}
          </View>
          {data.sale_price ? (
            <Text style={styles.priceRow}>
              <Text style={styles.priceVal}>{formatDZD(data.sale_price)}</Text>
              <Text style={styles.priceCur}> DZD</Text>
            </Text>
          ) : null}
        </View>

        {/* Stock display */}
        <View style={[
          styles.stockCard,
          isOut && styles.stockCardDanger,
          isLow && styles.stockCardWarn,
        ]}>
          <Text style={[styles.stockNum, isOut && { color: C.danger }, isLow && { color: C.warning }]}>
            {data.stock_qty}
          </Text>
          <Text style={styles.stockUnit}>unités en stock</Text>
          {isOut && (
            <View style={[styles.badge, { backgroundColor: C.danger }]}>
              <Text style={styles.badgeText}>RUPTURE</Text>
            </View>
          )}
          {isLow && (
            <View style={[styles.badge, { backgroundColor: C.warning }]}>
              <Text style={styles.badgeText}>STOCK BAS · Seuil {data.alert_threshold}</Text>
            </View>
          )}
        </View>

        {/* Adjustment */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ajuster le stock</Text>

          {/* Quantity input */}
          <View style={styles.qtyRow}>
            <Pressable
              style={styles.qtyBtn}
              onPress={() => setDelta((v) => String((parseInt(v, 10) || 0) - 1))}
            >
              <Ionicons name="remove" size={22} color={C.textSecondary} />
            </Pressable>
            <TextInput
              style={[
                styles.qtyInput,
                isValid && { borderColor: isPositive ? C.success : C.danger },
              ]}
              value={delta}
              onChangeText={setDelta}
              keyboardType="numbers-and-punctuation"
              placeholder="0"
              placeholderTextColor={C.textMuted}
              textAlign="center"
            />
            <Pressable
              style={styles.qtyBtn}
              onPress={() => setDelta((v) => String((parseInt(v, 10) || 0) + 1))}
            >
              <Ionicons name="add" size={22} color={C.textSecondary} />
            </Pressable>
          </View>
          {isValid && (
            <Text style={[styles.qtyHint, { color: isPositive ? C.success : C.danger }]}>
              {isPositive ? "+" : ""}{parsedDelta} → nouveau stock : {data.stock_qty + parsedDelta}
            </Text>
          )}

          {/* Reason */}
          <Text style={styles.fieldLabel}>Motif</Text>
          <View style={styles.reasonGrid}>
            {REASONS.map((r) => {
              const active = reason === r.value;
              return (
                <Pressable
                  key={r.value}
                  style={[styles.reasonBtn, active && styles.reasonBtnActive]}
                  onPress={() => setReason(r.value)}
                >
                  <Ionicons
                    name={r.icon}
                    size={18}
                    color={active ? C.primary : C.textMuted}
                  />
                  <Text style={[styles.reasonLabel, active && styles.reasonLabelActive]}>
                    {r.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            style={[styles.submitBtn, (!isValid || saving) && styles.submitBtnDisabled]}
            onPress={handleAdjust}
            disabled={!isValid || saving}
          >
            {saving ? (
              <ActivityIndicator color={C.white} />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color={C.white} />
                <Text style={styles.submitText}>Enregistrer</Text>
              </>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: C.surface },
  content: { padding: C.space.lg, gap: C.space.md, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: C.space.md },
  errorText: { fontSize: 16, color: C.danger, fontWeight: "600" },

  identityCard: { backgroundColor: C.white, borderRadius: C.radius.lg, padding: C.space.xl, ...C.shadow.sm },
  variantName: { fontSize: 20, fontWeight: "800", color: C.text, letterSpacing: -0.3, marginBottom: C.space.sm },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: C.space.xs, marginBottom: C.space.md },
  tag: { flexDirection: "row", alignItems: "center", backgroundColor: C.surfaceAlt, borderRadius: C.radius.full, paddingHorizontal: C.space.md, paddingVertical: 4, gap: 4 },
  tagMono: { backgroundColor: C.borderLight },
  tagText: { fontSize: 12, color: C.textSecondary, fontWeight: "600" },
  priceRow: { marginTop: 4 },
  priceVal: { fontSize: 22, fontWeight: "800", color: C.primary },
  priceCur: { fontSize: 13, color: C.textMuted, fontWeight: "600" },

  stockCard: { backgroundColor: C.successBg, borderRadius: C.radius.lg, padding: C.space.xl, alignItems: "center", borderWidth: 1, borderColor: C.successBorder },
  stockCardWarn: { backgroundColor: C.warningBg, borderColor: C.warningBorder },
  stockCardDanger: { backgroundColor: C.dangerBg, borderColor: C.dangerBorder },
  stockNum: { fontSize: 56, fontWeight: "900", color: C.success, letterSpacing: -2 },
  stockUnit: { fontSize: 13, color: C.textMuted, fontWeight: "500", marginTop: 2 },
  badge: { marginTop: C.space.sm, borderRadius: C.radius.full, paddingHorizontal: C.space.md, paddingVertical: 4 },
  badgeText: { color: C.white, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },

  card: { backgroundColor: C.white, borderRadius: C.radius.lg, padding: C.space.xl, ...C.shadow.sm },
  cardTitle: { fontSize: 16, fontWeight: "700", color: C.text, marginBottom: C.space.lg },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: C.space.md, marginBottom: C.space.xs },
  qtyBtn: { width: 44, height: 44, borderRadius: C.radius.md, backgroundColor: C.surfaceAlt, justifyContent: "center", alignItems: "center" },
  qtyInput: { flex: 1, height: 52, borderWidth: 1.5, borderColor: C.border, borderRadius: C.radius.md, fontSize: 28, fontWeight: "800", color: C.text, backgroundColor: C.surface, textAlign: "center" },
  qtyHint: { textAlign: "center", fontSize: 13, fontWeight: "600", marginBottom: C.space.lg },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: C.textMuted, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: C.space.sm, marginTop: C.space.md },
  reasonGrid: { flexDirection: "row", flexWrap: "wrap", gap: C.space.sm, marginBottom: C.space.xl },
  reasonBtn: { flexDirection: "row", alignItems: "center", gap: C.space.xs, borderWidth: 1.5, borderColor: C.border, borderRadius: C.radius.md, paddingHorizontal: C.space.md, paddingVertical: C.space.sm, backgroundColor: C.surface },
  reasonBtnActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  reasonLabel: { fontSize: 13, color: C.textMuted, fontWeight: "600" },
  reasonLabelActive: { color: C.primary },
  submitBtn: { backgroundColor: C.primary, borderRadius: C.radius.md, paddingVertical: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: C.space.sm, ...C.shadow.sm },
  submitBtnDisabled: { opacity: 0.4 },
  submitText: { color: C.white, fontWeight: "700", fontSize: 16 },
});
