import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  AlertTriangle,
  Search,
  Link2,
  Sparkles,
} from "lucide-react";
import api, { getApiError } from "@/lib/api";
import type { Supplier, PurchaseOrder, Product } from "@/types";
import {
  DocumentScanReviewModal,
  type ScanColumnDefinition,
  type ScanRowBase,
  type ScanTokenBox,
} from "@/components/scanner/DocumentScanReviewModal";

export interface ScannedPOLineRow extends ScanRowBase {
  row_index: number;
  reference: string;
  description: string;
  size: string;
  size_eu: number;
  colour: string;
  cartons: number;
  pairs_per_carton: number;
  quantity: number;
  unit_price: string;
  line_total: string;
  confidence: "exact" | "partial" | "unmatched";
  match_status: "matched" | "missing_variant" | "new_product";
  product_id: string | null;
  product_name: string | null;
  product_reference?: string | null;
  variant_id: string | null;
  bbox?: [number, number, number, number] | null;
  raw_text?: string;
}

export interface ImagePOImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedSupplierId?: string | number | null;
  onSuccess?: (createdPO: PurchaseOrder) => void;
}

export function ImagePOImportModal({
  isOpen,
  onClose,
  preselectedSupplierId,
  onSuccess,
}: ImagePOImportModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [supplierId, setSupplierId] = useState<string>(
    preselectedSupplierId ? String(preselectedSupplierId) : ""
  );
  const [suppliersList, setSuppliersList] = useState<Supplier[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [poReference, setPoReference] = useState<string>("");
  const [quickCreateProducts, setQuickCreateProducts] = useState<boolean>(true);
  const [detectedSupplierBanner, setDetectedSupplierBanner] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>({
    width: 1200,
    height: 800,
  });
  const [tokens, setTokens] = useState<ScanTokenBox[]>([]);
  const [rows, setRows] = useState<ScannedPOLineRow[]>([]);
  const [bindingRowIdx, setBindingRowIdx] = useState<number | null>(null);
  const [bindSearchQuery, setBindSearchQuery] = useState<string>("");

  useEffect(() => {
    if (preselectedSupplierId) {
      setSupplierId(String(preselectedSupplierId));
    }
  }, [preselectedSupplierId]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    api
      .get("/suppliers/?page_size=200")
      .then((res) => {
        if (!active) return;
        const list = res.data?.results ?? res.data ?? [];
        setSuppliersList(Array.isArray(list) ? list : []);
      })
      .catch(() => {});

    api
      .get("/inventory/products/?page_size=200")
      .then((res) => {
        if (!active) return;
        const list = res.data?.results ?? res.data ?? [];
        setCatalogProducts(Array.isArray(list) ? list : []);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [isOpen]);

  const scanMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post(
        "/suppliers/purchase-orders/scan-image/",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      return res.data;
    },
    onSuccess: (data) => {
      setErrorMsg(null);
      if (data.image_meta?.width && data.image_meta?.height) {
        setImageSize({
          width: data.image_meta.width,
          height: data.image_meta.height,
        });
      }
      setTokens(Array.isArray(data.tokens) ? data.tokens : []);
      setRows(Array.isArray(data.rows) ? data.rows : []);

      if (data.metadata?.document_reference && !poReference) {
        setPoReference(String(data.metadata.document_reference));
      }
      if (data.detected_supplier?.id) {
        if (!supplierId) {
          setSupplierId(String(data.detected_supplier.id));
        }
        setDetectedSupplierBanner(data.detected_supplier.name);
      } else {
        setDetectedSupplierBanner(null);
      }
    },
    onError: (err) => {
      setErrorMsg(getApiError(err));
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        supplier_id: supplierId,
        reference: poReference,
        notes: t("scanner.po_imported_via_ocr_note", "Importé par scan photo OCR hors-ligne"),
        quick_create_products: quickCreateProducts,
        lines: rows.map((r, idx) => ({
          row_index: idx + 1,
          reference: r.reference || "",
          description: r.description || r.reference || "Article",
          size: r.size || "",
          size_eu: Number(r.size_eu) || 0,
          colour: r.colour || "Standard",
          cartons: Number(r.cartons) || 0,
          pairs_per_carton: Number(r.pairs_per_carton) || 10,
          quantity: Math.max(1, Number(r.quantity) || 1),
          unit_price: String(r.unit_price || "0.00"),
          match_status: r.match_status || "new_product",
          product_id: r.product_id || null,
          product_name: r.product_name || null,
          variant_id: r.variant_id || null,
        })),
      };
      const res = await api.post(
        "/suppliers/purchase-orders/import-confirm/",
        payload
      );
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      if (onSuccess && data?.purchase_order) {
        onSuccess(data.purchase_order);
      }
      onClose();
    },
    onError: (err) => {
      setErrorMsg(getApiError(err));
    },
  });

  const filteredCatalog = useMemo(() => {
    const q = bindSearchQuery.trim().toLowerCase();
    if (!q) return catalogProducts.slice(0, 8);
    return catalogProducts
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.reference && p.reference.toLowerCase().includes(q)) ||
          (p.brand && p.brand.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [catalogProducts, bindSearchQuery]);

  const handleUploadFile = (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      setErrorMsg(t("scanner.file_size_limit_exceeded", "L'image dépasse la taille maximale autorisée de 15 Mo."));
      return;
    }
    const localUrl = URL.createObjectURL(file);
    setImageUrl(localUrl);
    scanMutation.mutate(file);
  };

  const handleRowCellEdit = (
    row: ScannedPOLineRow,
    key: string,
    value: any
  ): ScannedPOLineRow => {
    const updated: ScannedPOLineRow = { ...row, [key]: value };
    const qty = Math.max(0, Number(updated.quantity) || 0);
    const price = parseFloat(String(updated.unit_price || "0").replace(",", ".")) || 0;
    updated.line_total = (qty * price).toFixed(2);
    return updated;
  };

  const createEmptyPORow = (): ScannedPOLineRow => ({
    row_index: rows.length + 1,
    reference: "",
    description: "",
    size: "37-41",
    size_eu: 0,
    colour: "Standard",
    cartons: 1,
    pairs_per_carton: 10,
    quantity: 10,
    unit_price: "0.00",
    line_total: "0.00",
    confidence: "unmatched",
    match_status: "new_product",
    product_id: null,
    product_name: null,
    variant_id: null,
    bbox: null,
  });

  const columns: ScanColumnDefinition<ScannedPOLineRow>[] = [
    {
      key: "reference",
      label: t("po_import.col_reference", "Réf."),
      width: "120px",
    },
    {
      key: "description",
      label: t("po_import.col_description", "Désignation"),
      width: "180px",
    },
    {
      key: "size",
      label: t("po_import.col_size", "Pointure"),
      align: "center",
      width: "90px",
    },
    {
      key: "cartons",
      label: t("po_import.col_cartons", "Cartons"),
      type: "number",
      align: "right",
      width: "75px",
      subtotalType: "sum",
    },
    {
      key: "quantity",
      label: t("po_import.col_quantity", "Paires"),
      type: "number",
      align: "right",
      width: "80px",
      subtotalType: "sum",
    },
    {
      key: "unit_price",
      label: t("po_import.col_unit_price", "P.U. (DA)"),
      align: "right",
      width: "105px",
    },
    {
      key: "line_total",
      label: t("po_import.col_total", "Total HT"),
      align: "right",
      width: "115px",
      subtotalType: "currency",
      renderCell: (row) => (
        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
          {row.line_total} DA
        </span>
      ),
    },
    {
      key: "confidence",
      label: t("scanner.col_catalog_match", "Catalogue"),
      align: "left",
      width: "185px",
      renderCell: (row, rIdx, updateRow) => {
        const isMatched =
          row.confidence === "exact" ||
          row.confidence === "partial" ||
          Boolean(row.product_id);
        return (
          <div className="relative">
            {isMatched ? (
              <div className="flex items-center justify-between gap-1 px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium">
                <span className="inline-flex items-center gap-1 truncate">
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {row.product_name || t("scanner.matched_sku", "Lié au catalogue")}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setBindingRowIdx(bindingRowIdx === rIdx ? null : rIdx);
                    setBindSearchQuery("");
                  }}
                  title={t("scanner.change_bound_product", "Changer d'article")}
                  className="text-[10px] underline ml-1 shrink-0"
                >
                  {t("common.edit", "Modifier")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setBindingRowIdx(bindingRowIdx === rIdx ? null : rIdx);
                  setBindSearchQuery(row.reference || "");
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-[11px] font-medium hover:bg-amber-100 dark:hover:bg-amber-900/50 transition"
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {t("scanner.uncatalogued_bind", "Non catalogué • Lier")}
                </span>
              </button>
            )}

            {bindingRowIdx === rIdx && (
              <div className="absolute right-0 mt-1 w-64 z-30 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl p-2">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 mb-1.5">
                  <Search className="h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={bindSearchQuery}
                    onChange={(e) => setBindSearchQuery(e.target.value)}
                    placeholder={t("scanner.search_catalog_placeholder", "Chercher réf. ou modèle...")}
                    className="w-full bg-transparent text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden"
                  />
                </div>
                <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredCatalog.map((prod) => (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => {
                        updateRow({
                          product_id: String(prod.id),
                          product_name: prod.name,
                          reference: prod.reference || row.reference,
                          description: prod.name,
                          confidence: "partial",
                          match_status: "matched",
                        });
                        setBindingRowIdx(null);
                      }}
                      className="w-full text-left px-2 py-1.5 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-md flex items-center justify-between text-xs"
                    >
                      <div className="truncate">
                        <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {prod.name}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">
                          {prod.reference || "-"}
                        </div>
                      </div>
                      <Link2 className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                    </button>
                  ))}
                  {filteredCatalog.length === 0 && (
                    <div className="py-2 text-center text-[11px] text-slate-400">
                      {t("scanner.no_matching_product", "Aucun article trouvé")}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      },
    },
  ];

  const topControls = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Supplier Selector */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="ocr-po-supplier-select"
            className="text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            {t("po_import.supplier_label", "Fournisseur")} *
          </label>
          <select
            id="ocr-po-supplier-select"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          >
            <option value="">
              {t("po_import.select_supplier", "Sélectionner un fournisseur...")}
            </option>
            {suppliersList.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name} {s.phone ? `(${s.phone})` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* PO / BL Reference */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="ocr-po-ref-input"
            className="text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            {t("po_import.po_reference_label", "Réf. Bon / BL")}
          </label>
          <input
            id="ocr-po-ref-input"
            type="text"
            value={poReference}
            onChange={(e) => setPoReference(e.target.value)}
            placeholder="BL-2026-..."
            className="px-2.5 py-1.5 rounded-lg text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 w-36"
          />
        </div>

        {/* Auto-create new products toggle */}
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={quickCreateProducts}
            onChange={(e) => setQuickCreateProducts(e.target.checked)}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span>
            {t(
              "po_import.quick_create_products",
              "Créer automatiquement les nouveaux articles au catalogue"
            )}
          </span>
        </label>
      </div>

      {/* Detected supplier badge or error */}
      <div className="flex items-center gap-2">
        {detectedSupplierBanner && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
            <Sparkles className="h-3.5 w-3.5" />
            {t("scanner.detected_supplier_badge", "Fournisseur détecté")} : {detectedSupplierBanner}
          </span>
        )}
        {errorMsg && (
          <span className="text-xs font-medium text-rose-600 dark:text-rose-400">
            {errorMsg}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <DocumentScanReviewModal<ScannedPOLineRow>
      isOpen={isOpen}
      onClose={onClose}
      title={t(
        "scanner.po_modal_title",
        "Scanner un bon fournisseur (Photo / Image hors-ligne)"
      )}
      subtitle={t(
        "scanner.po_modal_subtitle",
        "Extraction automatique des références, pointures (ex: 37-41), colisages (12c/20p) et prix unitaires"
      )}
      imageUrl={imageUrl}
      imageWidth={imageSize.width}
      imageHeight={imageSize.height}
      tokens={tokens}
      columns={columns}
      rows={rows}
      onRowsChange={setRows}
      createEmptyRow={createEmptyPORow}
      onRowCellEdit={handleRowCellEdit}
      onUploadFile={handleUploadFile}
      isScanning={scanMutation.isPending}
      topControlsSlot={topControls}
      primaryActionLabel={t(
        "scanner.generate_purchase_order",
        "Générer le bon de commande"
      )}
      onPrimaryAction={() => confirmMutation.mutate()}
      isSubmitting={confirmMutation.isPending}
      disablePrimaryAction={!supplierId || rows.length === 0}
    />
  );
}

export default ImagePOImportModal;

