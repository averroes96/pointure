import React, { useState, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Plus,
  Trash2,
  Upload,
  ScanLine,
  Eye,
  EyeOff,
} from "lucide-react";
import { formatDZD } from "@/lib/api";

export interface ScanTokenBox {
  text: string;
  bbox: [number, number, number, number];
  confidence?: number;
}

export interface ScanRowBase {
  row_index?: number;
  bbox?: [number, number, number, number] | null;
  raw_text?: string;
  [key: string]: any;
}

export interface ScanColumnDefinition<TRow extends ScanRowBase = ScanRowBase> {
  key: string;
  label: string;
  type?: "text" | "number" | "currency" | "custom";
  align?: "left" | "center" | "right";
  width?: string;
  placeholder?: string;
  subtotalType?: "sum" | "currency";
  renderCell?: (
    row: TRow,
    rowIndex: number,
    updateRow: (patch: Partial<TRow>) => void
  ) => React.ReactNode;
}

export interface DocumentScanReviewModalProps<
  TRow extends ScanRowBase = ScanRowBase
> {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  imageUrl: string | null;
  imageWidth?: number;
  imageHeight?: number;
  tokens?: ScanTokenBox[];
  columns: ScanColumnDefinition<TRow>[];
  rows: TRow[];
  onRowsChange: (rows: TRow[]) => void;
  createEmptyRow: () => TRow;
  onRowCellEdit?: (row: TRow, key: string, value: any) => TRow;
  onUploadFile?: (file: File) => void;
  isScanning?: boolean;
  topControlsSlot?: React.ReactNode;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  isSubmitting?: boolean;
  disablePrimaryAction?: boolean;
}

export function DocumentScanReviewModal<TRow extends ScanRowBase = ScanRowBase>({
  isOpen,
  onClose,
  title,
  subtitle,
  imageUrl,
  imageWidth = 1200,
  imageHeight = 800,
  tokens = [],
  columns,
  rows,
  onRowsChange,
  createEmptyRow,
  onRowCellEdit,
  onUploadFile,
  isScanning = false,
  topControlsSlot,
  primaryActionLabel,
  onPrimaryAction,
  isSubmitting = false,
  disablePrimaryAction = false,
}: DocumentScanReviewModalProps<TRow>) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [activeRowIndex, setActiveRowIndex] = useState<number | null>(null);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState<boolean>(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const subtotals = useMemo(() => {
    const result: Record<string, string | number> = {};
    for (const col of columns) {
      if (!col.subtotalType) continue;
      const total = rows.reduce((acc, row) => {
        const raw = row[col.key];
        const num = typeof raw === "number" ? raw : parseFloat(String(raw ?? "0").replace(",", "."));
        return acc + (Number.isFinite(num) ? num : 0);
      }, 0);
      result[col.key] = col.subtotalType === "currency" ? formatDZD(total) : total;
    }
    return result;
  }, [columns, rows]);

  if (!isOpen) return null;

  const handleZoomIn = () => setZoom((z) => Math.min(3.5, +(z + 0.25).toFixed(2)));
  const handleZoomOut = () => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)));
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageUrl) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleCellChange = (rowIndex: number, key: string, rawVal: any) => {
    const nextRows = rows.map((r, idx) => {
      if (idx !== rowIndex) return r;
      if (onRowCellEdit) {
        return onRowCellEdit(r, key, rawVal);
      }
      return { ...r, [key]: rawVal };
    });
    onRowsChange(nextRows);
  };

  const handlePatchRow = (rowIndex: number, patch: Partial<TRow>) => {
    const nextRows = rows.map((r, idx) => (idx === rowIndex ? { ...r, ...patch } : r));
    onRowsChange(nextRows);
  };

  const handleAddRow = () => {
    onRowsChange([...rows, createEmptyRow()]);
  };

  const handleDeleteRow = (rowIndex: number) => {
    onRowsChange(rows.filter((_, idx) => idx !== rowIndex));
    if (activeRowIndex === rowIndex) {
      setActiveRowIndex(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadFile) {
      onUploadFile(file);
    }
    e.target.value = "";
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-3 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="flex flex-col w-full max-w-[96vw] h-[92vh] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
              <ScanLine className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {title}
              </h2>
              {subtitle && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onUploadFile && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/bmp"
                  className="hidden"
                  onChange={handleFileChange}
                  data-testid="scanner-file-input"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isScanning}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {t("scanner.upload_image", "Charger une image / photo")}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close", "Fermer")}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Optional Domain Top Banner (e.g. Supplier selector, document metadata, catalog badges) */}
        {topControlsSlot && (
          <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            {topControlsSlot}
          </div>
        )}

        {/* Split-Screen Body */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
          {/* LEFT PANE: Image Pan/Zoom Canvas + Interactive SVG Bounding Boxes */}
          <div className="lg:col-span-5 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 min-h-[260px] overflow-hidden">
            {/* Canvas Toolbar */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 text-xs">
              <span className="font-medium text-slate-600 dark:text-slate-300">
                {t("scanner.document_preview", "Aperçu du document")} ({Math.round(zoom * 100)}%)
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowBoundingBoxes((v) => !v)}
                  title={t("scanner.toggle_boxes", "Afficher/masquer les zones OCR")}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {showBoundingBoxes ? (
                    <Eye className="h-3.5 w-3.5 text-indigo-500" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5" />
                  )}
                  <span>{t("scanner.ocr_zones", "Zones OCR")}</span>
                </button>
                <button
                  type="button"
                  onClick={handleZoomOut}
                  aria-label={t("scanner.zoom_out", "Dézoomer")}
                  className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  aria-label={t("scanner.zoom_in", "Zoomer")}
                  className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleResetView}
                  aria-label={t("scanner.reset_zoom", "Réinitialiser la vue")}
                  className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Interactive Viewport */}
            <div
              className="relative flex-1 overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {isScanning ? (
                <div className="flex flex-col items-center gap-3 p-6 text-center">
                  <div className="h-10 w-10 rounded-full border-3 border-indigo-500 border-t-transparent animate-spin" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {t("scanner.scanning_in_progress", "Analyse optique hors-ligne (OpenCV + RapidOCR)...")}
                  </p>
                </div>
              ) : imageUrl ? (
                <div
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "center center",
                  }}
                  className="relative inline-block transition-transform duration-75"
                >
                  <img
                    src={imageUrl}
                    alt={t("scanner.scanned_document", "Document scanné")}
                    className="max-w-full max-h-[68vh] object-contain rounded-md shadow-md pointer-events-none"
                  />
                  {showBoundingBoxes && imageWidth > 0 && imageHeight > 0 && (
                    <svg
                      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
                      className="absolute inset-0 w-full h-full pointer-events-auto"
                      data-testid="scanner-svg-overlay"
                    >
                      {/* Token bounding boxes */}
                      {tokens.map((tok, tIdx) => {
                        const [x1, y1, x2, y2] = tok.bbox;
                        return (
                          <rect
                            key={`tok-${tIdx}`}
                            x={x1}
                            y={y1}
                            width={Math.max(2, x2 - x1)}
                            height={Math.max(2, y2 - y1)}
                            className="fill-indigo-500/10 stroke-indigo-400/50"
                            strokeWidth={1.5}
                          >
                            <title>{tok.text}</title>
                          </rect>
                        );
                      })}
                      {/* Row bounding boxes (interactive highlight) */}
                      {rows.map((row, rIdx) => {
                        if (!row.bbox || row.bbox.length !== 4) return null;
                        const [rx1, ry1, rx2, ry2] = row.bbox;
                        const isActive = activeRowIndex === rIdx;
                        return (
                          <rect
                            key={`row-box-${rIdx}`}
                            x={rx1 - 4}
                            y={ry1 - 3}
                            width={Math.max(4, rx2 - rx1 + 8)}
                            height={Math.max(4, ry2 - ry1 + 6)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveRowIndex(rIdx);
                            }}
                            className={
                              isActive
                                ? "fill-amber-400/25 stroke-amber-500 cursor-pointer"
                                : "fill-emerald-500/10 stroke-emerald-500/60 hover:fill-amber-400/20 cursor-pointer"
                            }
                            strokeWidth={isActive ? 3 : 1.75}
                            rx={4}
                          />
                        );
                      })}
                    </svg>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 p-8 text-center max-w-sm">
                  <div className="p-4 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 text-slate-500 dark:text-slate-400">
                    <Upload className="h-8 w-8" />
                  </div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {t("scanner.drop_or_select_title", "Glissez ou sélectionnez une photo de bon fournisseur")}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t(
                      "scanner.drop_or_select_hint",
                      "Redressement automatique de l'inclinaison et reconnaissance optique 100% hors-ligne."
                    )}
                  </p>
                  {onUploadFile && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-1 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs transition"
                    >
                      {t("scanner.choose_photo", "Choisir une photo (PNG / JPG)")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT PANE: Dynamic Editable Table */}
          <div className="lg:col-span-7 flex flex-col bg-white dark:bg-slate-900 min-h-0 overflow-hidden">
            {/* Table Toolbar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {t("scanner.detected_lines", "Lignes détectées")} ({rows.length})
              </div>
              <button
                type="button"
                onClick={handleAddRow}
                data-testid="scanner-add-row-btn"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("scanner.add_line", "Ajouter une ligne")}
              </button>
            </div>

            {/* Editable Table Container */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-2.5 w-8 text-center font-semibold">#</th>
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        style={col.width ? { width: col.width } : undefined}
                        className={`py-2.5 px-2.5 font-semibold ${
                          col.align === "right"
                            ? "text-right"
                            : col.align === "center"
                            ? "text-center"
                            : "text-left"
                        }`}
                      >
                        {col.label}
                      </th>
                    ))}
                    <th className="py-2.5 px-2.5 w-10 text-center font-semibold">
                      {t("common.actions", "Actions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={columns.length + 2}
                        className="py-12 text-center text-slate-400 dark:text-slate-500"
                      >
                        {t(
                          "scanner.no_lines_yet",
                          "Aucune ligne extraite pour le moment. Chargez une image ou ajoutez une ligne manuellement."
                        )}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, rIdx) => {
                      const isRowActive = activeRowIndex === rIdx;
                      return (
                        <tr
                          key={`scan-row-${rIdx}`}
                          onMouseEnter={() => setActiveRowIndex(rIdx)}
                          onFocus={() => setActiveRowIndex(rIdx)}
                          className={`transition-colors ${
                            isRowActive
                              ? "bg-amber-50/70 dark:bg-amber-950/30"
                              : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                          }`}
                        >
                          <td className="py-2 px-2.5 text-center font-mono text-slate-400 dark:text-slate-500">
                            {rIdx + 1}
                          </td>
                          {columns.map((col) => (
                            <td
                              key={`${rIdx}-${col.key}`}
                              className={`py-1.5 px-2 ${
                                col.align === "right"
                                  ? "text-right"
                                  : col.align === "center"
                                  ? "text-center"
                                  : "text-left"
                              }`}
                            >
                              {col.renderCell ? (
                                col.renderCell(row, rIdx, (patch) =>
                                  handlePatchRow(rIdx, patch)
                                )
                              ) : (
                                <input
                                  type={col.type === "number" ? "number" : "text"}
                                  value={row[col.key] ?? ""}
                                  placeholder={col.placeholder}
                                  onChange={(e) =>
                                    handleCellChange(
                                      rIdx,
                                      col.key,
                                      col.type === "number"
                                        ? parseInt(e.target.value || "0", 10)
                                        : e.target.value
                                    )
                                  }
                                  className={`w-full px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500 ${
                                    col.align === "right"
                                      ? "text-right font-mono"
                                      : col.align === "center"
                                      ? "text-center"
                                      : "text-left"
                                  }`}
                                />
                              )}
                            </td>
                          ))}
                          <td className="py-1.5 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteRow(rIdx)}
                              title={t("scanner.delete_noise_row", "Supprimer cette ligne")}
                              aria-label={t("scanner.delete_noise_row", "Supprimer cette ligne")}
                              data-testid={`scanner-delete-row-${rIdx}`}
                              className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {rows.length > 0 && Object.keys(subtotals).length > 0 && (
                  <tfoot className="sticky bottom-0 bg-slate-100 dark:bg-slate-950 border-t-2 border-slate-300 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-100">
                    <tr>
                      <td className="py-2.5 px-2.5 text-center">Σ</td>
                      {columns.map((col) => (
                        <td
                          key={`sub-${col.key}`}
                          className={`py-2.5 px-2.5 font-mono ${
                            col.align === "right"
                              ? "text-right"
                              : col.align === "center"
                              ? "text-center"
                              : "text-left"
                          }`}
                        >
                          {subtotals[col.key] !== undefined ? subtotals[col.key] : ""}
                        </td>
                      ))}
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {t(
              "scanner.review_footer_hint",
              "Survolez ou cliquez sur une ligne pour mettre en surbrillance la zone correspondante sur l'image."
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              {t("common.cancel", "Annuler")}
            </button>
            <button
              type="button"
              onClick={onPrimaryAction}
              disabled={disablePrimaryAction || isSubmitting || rows.length === 0}
              data-testid="scanner-confirm-btn"
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white shadow-xs transition"
            >
              {isSubmitting
                ? t("common.saving", "Enregistrement...")
                : primaryActionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
export default DocumentScanReviewModal;

