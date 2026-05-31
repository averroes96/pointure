import { Ionicons } from "@expo/vector-icons";
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
import { C } from "@/constants";
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

function StockBadge({ variant }: { variant: ScanResult["variant"] }) {
  const isOut = variant.is_out_of_stock;
  const isLow = variant.is_low_stock && !isOut;
  const color = isOut ? C.danger : isLow ? C.warning : C.success;
  const bg = isOut ? C.dangerBg : isLow ? C.warningBg : C.successBg;
  const border = isOut ? C.dangerBorder : isLow ? C.warningBorder : C.successBorder;
  const label = isOut ? "Rupture de stock" : isLow ? "Stock bas" : "En stock";

  return (
    <View style={[styles.stockBadge, { backgroundColor: bg, borderColor: border }]}>
      <View style={[styles.stockDot, { backgroundColor: color }]} />
      <Text style={[styles.stockQty, { color }]}>{variant.stock_qty}</Text>
      <Text style={styles.stockUnit}>unités · </Text>
      <Text style={[styles.stockStatus, { color }]}>{label}</Text>
    </View>
  );
}

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the camera currently sees — updates live but doesn't trigger a lookup
  const [detected, setDetected] = useState<string | null>(null);
  const cooldownRef = useRef(false);

  function handleBarcode({ data }: { data: string }) {
    if (loading || result) return;
    if (cooldownRef.current) return;
    cooldownRef.current = true;
    setTimeout(() => { cooldownRef.current = false; }, 300);
    setDetected(data);
  }

  async function confirmScan() {
    if (!detected || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.get(`/mobile/scan/?barcode=${encodeURIComponent(detected)}`);
      setResult(res.data);
      setDetected(null);
    } catch (err: any) {
      setError(
        err?.response?.status === 404
          ? `Article introuvable\n${detected}`
          : "Erreur de connexion"
      );
      setDetected(null);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setResult(null);
    setError(null);
    setDetected(null);
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <View style={[styles.permIcon, { backgroundColor: C.primaryBg }]}>
          <Ionicons name="camera-outline" size={32} color={C.primary} />
        </View>
        <Text style={styles.permTitle}>Accès caméra requis</Text>
        <Text style={styles.permSub}>
          Pour scanner les codes-barres des articles
        </Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Autoriser</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera */}
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          onBarcodeScanned={result || loading ? undefined : handleBarcode}
          barcodeScannerSettings={{ barcodeTypes: ["code128", "ean13", "ean8", "qr"] }}
        />

        {/* Dimmed corners */}
        <View style={styles.overlay}>
          <View style={styles.overlayRow}><View style={styles.overlayFill} /><View style={styles.frame} /><View style={styles.overlayFill} /></View>
        </View>

        {/* Corner marks */}
        {["tl", "tr", "bl", "br"].map((pos) => (
          <View key={pos} style={[styles.corner, styles[pos as keyof typeof styles] as object]} />
        ))}

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={C.white} />
            <Text style={styles.loadingText}>Identification...</Text>
          </View>
        )}

        {/* Live detected code + confirm button */}
        {!loading && !result && detected ? (
          <View style={styles.detectedBar}>
            <View style={styles.detectedInfo}>
              <Ionicons name="barcode-outline" size={14} color={C.white} />
              <Text style={styles.detectedCode} numberOfLines={1}>{detected}</Text>
            </View>
            <Pressable style={styles.confirmBtn} onPress={confirmScan}>
              <Text style={styles.confirmText}>Rechercher</Text>
              <Ionicons name="arrow-forward-circle" size={18} color={C.white} />
            </Pressable>
          </View>
        ) : !loading && !result && !detected ? (
          <View style={styles.hintBanner}>
            <Ionicons name="barcode-outline" size={16} color={C.white} />
            <Text style={styles.hintText}>Pointez vers un code-barres</Text>
          </View>
        ) : null}
      </View>

      {/* Result panel */}
      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        {error && (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={28} color={C.danger} />
            <View style={{ flex: 1 }}>
              <Text style={styles.errorTitle}>Article non trouvé</Text>
              <Text style={styles.errorSub}>{error}</Text>
            </View>
            <Pressable onPress={reset}>
              <Ionicons name="refresh" size={22} color={C.textMuted} />
            </Pressable>
          </View>
        )}

        {!result && !error && (
          <View style={styles.emptyPanel}>
            <Text style={styles.emptyText}>Le résultat apparaîtra ici</Text>
          </View>
        )}

        {result && (
          <View style={styles.resultWrap}>
            {/* Product header */}
            <View style={styles.productRow}>
              <View style={styles.productMeta}>
                <Text style={styles.productName}>{result.product.name}</Text>
                <Text style={styles.productSub}>
                  {result.product.brand}
                  {result.variant.size_eu ? ` · T.${result.variant.size_eu}` : ""}
                  {result.variant.colour ? ` · ${result.variant.colour}` : ""}
                </Text>
              </View>
              <Text style={styles.priceTag}>{formatDZD(result.product.sale_price)} <Text style={styles.priceUnit}>DZD</Text></Text>
            </View>

            {/* Stock badge */}
            <StockBadge variant={result.variant} />

            {/* Per-branch */}
            {result.stock_by_branch.length > 1 && (
              <View style={styles.branchCard}>
                <Text style={styles.branchTitle}>Stock par agence</Text>
                {result.stock_by_branch.map((b, i) => (
                  <View
                    key={b.branch_id}
                    style={[styles.branchRow, i < result.stock_by_branch.length - 1 && styles.branchRowBorder]}
                  >
                    <View style={styles.branchDot} />
                    <Text style={styles.branchName}>{b.branch_name}</Text>
                    <Text style={[styles.branchQty, b.stock_qty === 0 && { color: C.danger }]}>
                      {b.stock_qty} u.
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Actions */}
            <View style={styles.actionRow}>
              <Pressable
                style={styles.btnPrimary}
                onPress={() => router.push(`/(app)/inventory/${result.variant.id}`)}
              >
                <Ionicons name="create-outline" size={18} color={C.white} />
                <Text style={styles.btnText}>Ajuster le stock</Text>
              </Pressable>
              <Pressable style={styles.btnGhost} onPress={reset}>
                <Ionicons name="scan-outline" size={18} color={C.textSecondary} />
                <Text style={styles.btnGhostText}>Scanner</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const FRAME_W = 230;
const FRAME_H = 130;
const CORNER = 20;
const CORNER_T = 3;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  cameraWrap: { height: 280, backgroundColor: C.black, position: "relative", overflow: "hidden" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
  },
  overlayRow: { flexDirection: "row", width: "100%", justifyContent: "center" },
  overlayFill: { flex: 1, height: FRAME_H, backgroundColor: "rgba(0,0,0,0.55)" },
  frame: { width: FRAME_W, height: FRAME_H },

  // Corner brackets
  corner: { position: "absolute", width: CORNER, height: CORNER, borderColor: C.white },
  tl: { top: "50%", left: "50%", marginTop: -FRAME_H / 2, marginLeft: -FRAME_W / 2, borderTopWidth: CORNER_T, borderLeftWidth: CORNER_T, borderTopLeftRadius: 4 },
  tr: { top: "50%", right: "50%", marginTop: -FRAME_H / 2, marginRight: -FRAME_W / 2, borderTopWidth: CORNER_T, borderRightWidth: CORNER_T, borderTopRightRadius: 4 },
  bl: { bottom: "50%", left: "50%", marginBottom: -FRAME_H / 2, marginLeft: -FRAME_W / 2, borderBottomWidth: CORNER_T, borderLeftWidth: CORNER_T, borderBottomLeftRadius: 4 },
  br: { bottom: "50%", right: "50%", marginBottom: -FRAME_H / 2, marginRight: -FRAME_W / 2, borderBottomWidth: CORNER_T, borderRightWidth: CORNER_T, borderBottomRightRadius: 4 },

  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { color: C.white, fontWeight: "600", fontSize: 14 },
  hintBanner: { position: "absolute", bottom: 16, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 14, paddingVertical: 7, borderRadius: C.radius.full },
  hintText: { color: C.white, fontSize: 13, fontWeight: "600" },
  detectedBar: { position: "absolute", bottom: 12, left: 12, right: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "rgba(0,0,0,0.75)", borderRadius: C.radius.md, paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  detectedInfo: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  detectedCode: { color: C.white, fontSize: 13, fontFamily: "monospace", flex: 1 },
  confirmBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primary, borderRadius: C.radius.sm, paddingHorizontal: 12, paddingVertical: 7 },
  confirmText: { color: C.white, fontWeight: "700", fontSize: 13 },

  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: C.space.xxl },
  permIcon: { width: 72, height: 72, borderRadius: C.radius.xl, justifyContent: "center", alignItems: "center", marginBottom: C.space.lg },
  permTitle: { fontSize: 18, fontWeight: "700", color: C.text, marginBottom: C.space.xs },
  permSub: { fontSize: 14, color: C.textMuted, textAlign: "center", marginBottom: C.space.xl },

  panel: { flex: 1 },
  panelContent: { padding: C.space.lg, paddingBottom: 32 },
  emptyPanel: { paddingVertical: 32, alignItems: "center" },
  emptyText: { color: C.textMuted, fontSize: 14, fontWeight: "500" },

  errorCard: { flexDirection: "row", alignItems: "center", gap: C.space.md, backgroundColor: C.dangerBg, borderRadius: C.radius.lg, padding: C.space.lg, borderWidth: 1, borderColor: C.dangerBorder },
  errorTitle: { fontSize: 14, fontWeight: "700", color: C.danger },
  errorSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },

  resultWrap: { gap: C.space.md },
  productRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", backgroundColor: C.white, borderRadius: C.radius.lg, padding: C.space.lg, ...C.shadow.sm },
  productMeta: { flex: 1, marginRight: C.space.md },
  productName: { fontSize: 17, fontWeight: "700", color: C.text },
  productSub: { fontSize: 13, color: C.textMuted, marginTop: 3, fontWeight: "500" },
  priceTag: { fontSize: 18, fontWeight: "800", color: C.primary },
  priceUnit: { fontSize: 12, fontWeight: "600", color: C.textMuted },

  stockBadge: { flexDirection: "row", alignItems: "center", borderRadius: C.radius.md, paddingHorizontal: C.space.lg, paddingVertical: C.space.md, borderWidth: 1, gap: C.space.sm },
  stockDot: { width: 8, height: 8, borderRadius: 4 },
  stockQty: { fontSize: 22, fontWeight: "800" },
  stockUnit: { fontSize: 13, color: C.textMuted, fontWeight: "500" },
  stockStatus: { fontSize: 13, fontWeight: "600" },

  branchCard: { backgroundColor: C.white, borderRadius: C.radius.lg, padding: C.space.lg, ...C.shadow.sm },
  branchTitle: { fontSize: 12, fontWeight: "700", color: C.textMuted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: C.space.md },
  branchRow: { flexDirection: "row", alignItems: "center", paddingVertical: C.space.sm, gap: C.space.sm },
  branchRowBorder: { borderBottomWidth: 1, borderBottomColor: C.borderLight },
  branchDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.border },
  branchName: { flex: 1, fontSize: 14, color: C.textSecondary, fontWeight: "500" },
  branchQty: { fontSize: 14, fontWeight: "700", color: C.text },

  actionRow: { flexDirection: "row", gap: C.space.sm },
  btn: { backgroundColor: C.primary, borderRadius: C.radius.md, paddingVertical: 13, alignItems: "center" },
  btnText: { color: C.white, fontWeight: "700", fontSize: 15 },
  btnPrimary: { flex: 1, backgroundColor: C.primary, borderRadius: C.radius.md, paddingVertical: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: C.space.sm, ...C.shadow.sm },
  btnGhost: { flex: 0, paddingHorizontal: C.space.lg, backgroundColor: C.surfaceAlt, borderRadius: C.radius.md, paddingVertical: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: C.space.xs },
  btnGhostText: { color: C.textSecondary, fontWeight: "600", fontSize: 14 },
});
