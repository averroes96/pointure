import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { COLORS } from "@/constants";
import api, { formatDZD } from "@/lib/api";

interface ScanResult {
  variant: {
    id: number;
    barcode: string;
    size_eu: string;
    colour: string;
    stock_qty: number;
    alert_threshold: number;
    is_low_stock: boolean;
    is_out_of_stock: boolean;
  };
  product: {
    id: number;
    name: string;
    brand: string;
    category: string;
    sale_price: string;
    purchase_price?: string;
  };
  stock_by_branch: { branch_id: number; branch_name: string; stock_qty: number }[];
}

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastScanned = useRef<string | null>(null);

  async function handleBarcode({ data }: { data: string }) {
    if (data === lastScanned.current || loading) return;
    lastScanned.current = data;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await api.get(`/mobile/scan/?barcode=${encodeURIComponent(data)}`);
      setResult(res.data);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setError(`Code-barres non trouvé : ${data}`);
      } else {
        setError("Erreur de connexion — réessayez.");
      }
    } finally {
      setLoading(false);
      setTimeout(() => { lastScanned.current = null; }, 3000);
    }
  }

  function reset() {
    setResult(null);
    setError(null);
    lastScanned.current = null;
  }

  if (!permission) return <View style={styles.center}><ActivityIndicator color={COLORS.primary} /></View>;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>Accès à la caméra requis pour scanner les codes-barres.</Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Autoriser la caméra</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera viewfinder */}
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          onBarcodeScanned={result || loading ? undefined : handleBarcode}
          barcodeScannerSettings={{ barcodeTypes: ["code128", "ean13", "ean8", "qr"] }}
        />
        {/* Targeting frame */}
        <View style={styles.frame} />
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={COLORS.white} />
          </View>
        )}
      </View>

      {/* Result panel */}
      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={reset}><Text style={styles.link}>Scanner à nouveau</Text></Pressable>
          </View>
        )}

        {!result && !error && (
          <Text style={styles.hint}>Pointez la caméra vers un code-barres</Text>
        )}

        {result && (
          <>
            <View style={styles.productHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{result.product.name}</Text>
                <Text style={styles.productSub}>{result.product.brand} · {result.variant.size_eu} · {result.variant.colour || "—"}</Text>
              </View>
              <Text style={styles.price}>{formatDZD(result.product.sale_price)} DZD</Text>
            </View>

            {/* Stock total */}
            <View style={[styles.stockBadge, result.variant.is_out_of_stock && styles.stockBadgeDanger, result.variant.is_low_stock && !result.variant.is_out_of_stock && styles.stockBadgeWarn]}>
              <Text style={styles.stockQty}>{result.variant.stock_qty}</Text>
              <Text style={styles.stockLabel}>unités en stock</Text>
            </View>

            {/* Per-branch breakdown */}
            {result.stock_by_branch.length > 1 && (
              <>
                <Text style={styles.sectionTitle}>Par agence</Text>
                {result.stock_by_branch.map((b) => (
                  <View key={b.branch_id} style={styles.branchRow}>
                    <Text style={styles.branchName}>{b.branch_name}</Text>
                    <Text style={[styles.branchQty, b.stock_qty === 0 && { color: COLORS.danger }]}>
                      {b.stock_qty}
                    </Text>
                  </View>
                ))}
              </>
            )}

            {/* Actions */}
            <Pressable
              style={styles.btn}
              onPress={() => router.push(`/(app)/inventory/${result.variant.id}`)}
            >
              <Text style={styles.btnText}>Ajuster le stock</Text>
            </Pressable>
            <Pressable style={styles.btnSecondary} onPress={reset}>
              <Text style={styles.btnSecondaryText}>Scanner un autre article</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  cameraWrap: { height: 260, backgroundColor: COLORS.black, position: "relative" },
  frame: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 220,
    height: 120,
    marginTop: -60,
    marginLeft: -110,
    borderWidth: 2,
    borderColor: COLORS.white,
    borderRadius: 8,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  permText: { color: COLORS.text, textAlign: "center", marginBottom: 16, fontSize: 15 },
  panel: { flex: 1 },
  panelContent: { padding: 16 },
  hint: { color: COLORS.textMuted, textAlign: "center", marginTop: 24, fontSize: 14 },
  errorBox: { backgroundColor: COLORS.dangerBg, borderRadius: 10, padding: 16, marginBottom: 12 },
  errorText: { color: COLORS.danger, marginBottom: 8 },
  link: { color: COLORS.primary, fontWeight: "600" },
  productHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  productName: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  productSub: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  price: { fontSize: 16, fontWeight: "700", color: COLORS.primary, marginLeft: 8 },
  stockBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.successBg,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  stockBadgeWarn: { backgroundColor: COLORS.warningBg },
  stockBadgeDanger: { backgroundColor: COLORS.dangerBg },
  stockQty: { fontSize: 28, fontWeight: "700", color: COLORS.text },
  stockLabel: { fontSize: 13, color: COLORS.textMuted },
  sectionTitle: { fontSize: 13, fontWeight: "600", color: COLORS.textMuted, marginBottom: 6 },
  branchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  branchName: { fontSize: 14, color: COLORS.text },
  branchQty: { fontSize: 14, fontWeight: "700", color: COLORS.text },
  btn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  btnText: { color: COLORS.white, fontWeight: "700", fontSize: 15 },
  btnSecondary: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
  },
  btnSecondaryText: { color: COLORS.text, fontSize: 14 },
});
