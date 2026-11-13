import React, { useState } from 'react';
import JSZip from 'jszip';
import api, { formatDZD, getApiError } from '@/lib/api';
import {
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FileSpreadsheet,
  Package,
  Users,
  Truck,
  ArrowRight,
  RefreshCw,
  Coins,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import BulkImportWizardModal, { ImportEntityType } from '@/components/import/BulkImportWizardModal';
import { cn } from '@/lib/utils';

interface LegacyImportTotals {
  client_debts?: number | string;
  client_credits?: number | string;
  supplier_debts?: number | string;
  supplier_credits?: number | string;
  unsettled_cheques?: number | string;
  part_payments?: number | string;
  stock_pairs?: number;
  stock_value?: number | string;
  stock_retail_value?: number | string;
}

interface LegacyWarningCounts {
  unknown_sizes?: number;
  products_without_price?: number;
  guessed_size_ranges?: number;
}

interface LegacyImportStats {
  dry_run?: boolean;
  suppliers_imported: number;
  clients_imported: number;
  products_imported: number;
  stock_units_imported: number;
  purchase_orders_imported: number;
  sales_imported: number;
  refunds_imported: number;
  defects_imported: number;
  cheques_imported?: number;
  part_payments_imported?: number;
  store_settings_updated?: boolean;
  counts?: Record<string, number>;
  totals?: LegacyImportTotals;
  warning_counts?: LegacyWarningCounts;
  warnings?: string[];
}

export const LegacyImportSection: React.FC = () => {
  const { t } = useTranslation();
  const [isZipping, setIsZipping] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pendingFile, setPendingFile] = useState<{ blob: Blob | File; filename: string } | null>(null);
  const [previewReport, setPreviewReport] = useState<LegacyImportStats | null>(null);
  const [result, setResult] = useState<LegacyImportStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [activeWizardEntity, setActiveWizardEntity] = useState<ImportEntityType | null>(null);

  const [options, setOptions] = useState({
    suppliers: true,
    clients: true,
    products: true,
    purchases: true,
    sales: true,
    software_type: 'retail', // 'retail' or 'wholesale'
    easy_mode: true, // true = Easy Mode (1 product = 1 SKU with real stock), false = expand sizes
  });

  const updateOption = <K extends keyof typeof options>(key: K, value: typeof options[K]) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
    // Clear previewReport and result whenever options change so user doesn't execute with stale preview (P1-7)
    setPreviewReport(null);
    setResult(null);
  };

  const sendImportRequest = async (blob: Blob | File, filename: string, dryRun: boolean) => {
    const formData = new FormData();
    formData.append('zip_file', blob, filename);
    formData.append('options', JSON.stringify({ ...options, dry_run: dryRun }));
    formData.append('dry_run', dryRun ? 'true' : 'false');

    const response = await api.post('/core/legacy-import/', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data.stats as LegacyImportStats;
  };

  const runPreview = async (blob: Blob | File, filename = 'legacy.zip') => {
    setIsZipping(false);
    setIsPreviewing(true);
    setProgress(100);
    setError(null);
    setResult(null);

    try {
      const stats = await sendImportRequest(blob, filename, true);
      setPendingFile({ blob, filename });
      setPreviewReport(stats);
    } catch (err: unknown) {
      setError(getApiError(err) || t('settings.legacy_import_error'));
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!pendingFile) return;

    setIsExecuting(true);
    setError(null);

    try {
      const stats = await sendImportRequest(pendingFile.blob, pendingFile.filename, false);
      setResult(stats);
      setPreviewReport(null);
      setPendingFile(null);
    } catch (err: unknown) {
      setError(getApiError(err) || t('settings.legacy_import_error'));
    } finally {
      setIsExecuting(false);
    }
  };

  const handleZipFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setResult(null);
    setPreviewReport(null);
    setPendingFile(null);

    try {
      await runPreview(file, file.name);
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleDirectorySelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setError(null);
    setResult(null);
    setPreviewReport(null);
    setPendingFile(null);
    setIsZipping(true);
    setProgress(0);

    try {
      // If user selected a .zip file via the selector
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
        await runPreview(files[0], files[0].name);
        return;
      }

      const zip = new JSZip();
      const dbfFiles: File[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.toLowerCase().endsWith('.dbf')) {
          dbfFiles.push(file);
        }
      }

      if (dbfFiles.length === 0) {
        throw new Error(t('settings.legacy_no_dbf_error'));
      }

      // Read each file buffer individually to detect and report locked files specifically
      for (let i = 0; i < dbfFiles.length; i++) {
        const file = dbfFiles[i];
        try {
          const buffer = await file.arrayBuffer();
          zip.file(file.name, buffer);
          setProgress(Math.round(((i + 1) / dbfFiles.length) * 45));
        } catch {
          throw new Error(t('settings.legacy_locked_file_error', { name: file.name }));
        }
      }

      setProgress(50);

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        setProgress(50 + Math.floor(meta.percent / 2));
      });

      await runPreview(zipBlob, 'legacy.zip');
    } catch (err: unknown) {
      setError(getApiError(err) || (err instanceof Error ? err.message : t('settings.legacy_import_error')));
    } finally {
      setIsZipping(false);
      if (e.target) e.target.value = '';
    }
  };

  const isBusy = isZipping || isPreviewing || isExecuting;

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Active Wizard Modal */}
      {activeWizardEntity && (
        <BulkImportWizardModal
          initialEntity={activeWizardEntity}
          onSuccess={() => setActiveWizardEntity(null)}
          onClose={() => setActiveWizardEntity(null)}
        />
      )}

      {/* Modern Bulk Excel & CSV Import Card */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-primary-50 via-primary-50/20 to-white dark:from-primary-950/40 dark:via-slate-900 dark:to-slate-900 border border-primary-200/80 dark:border-primary-900/50 shadow-xs space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-primary-600 text-white shadow-xs shadow-primary-500/20">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                {t('import_wizard.title')}
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300">
                  {t('settings.new_badge')}
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t('import_wizard.subtitle')}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <button
            type="button"
            onClick={() => setActiveWizardEntity('products')}
            className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-primary-400 dark:hover:border-primary-500 hover:shadow-xs transition-all text-start group cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-950/60 text-primary-600 dark:text-primary-400 flex items-center justify-center">
                <Package className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  {t('import_wizard.entity_products')}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  {t('settings.excel_csv')}
                </div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-primary-600 group-hover:translate-x-0.5 transition-all rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
          </button>

          <button
            type="button"
            onClick={() => setActiveWizardEntity('clients')}
            className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-primary-400 dark:hover:border-primary-500 hover:shadow-xs transition-all text-start group cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-950/60 text-primary-600 dark:text-primary-400 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  {t('import_wizard.entity_clients')}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  {t('settings.excel_csv')}
                </div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-primary-600 group-hover:translate-x-0.5 transition-all rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
          </button>

          <button
            type="button"
            onClick={() => setActiveWizardEntity('suppliers')}
            className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-primary-400 dark:hover:border-primary-500 hover:shadow-xs transition-all text-start group cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-950/60 text-primary-600 dark:text-primary-400 flex items-center justify-center">
                <Truck className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  {t('import_wizard.entity_suppliers')}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  {t('settings.excel_csv')}
                </div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-primary-600 group-hover:translate-x-0.5 transition-all rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
          </button>
        </div>
      </div>

      {/* Legacy DBF Migration Section */}
      <div className="space-y-5 pt-2">
        <div className="border-t border-slate-200/80 dark:border-slate-800 pt-6">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">{t('settings.legacy_migration')}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t('settings.legacy_desc')}
          </p>
        </div>

        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 rounded-2xl p-4 flex gap-3 text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">{t('settings.warning_proceed')}</h3>
            <p className="text-xs text-amber-800/90 dark:text-amber-300/90 mt-1 leading-relaxed">
              {t('settings.warning_desc')}
            </p>
          </div>
        </div>

        {/* Inventory Management Mode */}
        <div className="bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
            {t('settings.legacy_stock_mode_title')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className={cn(
              'p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3',
              options.easy_mode
                ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-950/30 ring-1 ring-primary-500/20'
                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-slate-50/40 dark:bg-slate-800/40'
            )}>
              <input
                type="radio"
                name="easy_mode"
                checked={options.easy_mode}
                onChange={() => updateOption('easy_mode', true)}
                disabled={isBusy}
                className="mt-0.5 border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  {t('settings.legacy_easy_mode_title')}
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                    {t('settings.legacy_default_badge')}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                  {t('settings.legacy_easy_mode_desc')}
                </p>
              </div>
            </label>

            <label className={cn(
              'p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3',
              !options.easy_mode
                ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-950/30 ring-1 ring-primary-500/20'
                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-slate-50/40 dark:bg-slate-800/40'
            )}>
              <input
                type="radio"
                name="easy_mode"
                checked={!options.easy_mode}
                onChange={() => updateOption('easy_mode', false)}
                disabled={isBusy}
                className="mt-0.5 border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  {t('settings.legacy_matrix_mode_title')}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                  {t('settings.legacy_matrix_mode_desc')}
                </p>
              </div>
            </label>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
            {t('settings.legacy_software_version')}
          </h3>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center space-x-2 rtl:space-x-reverse cursor-pointer">
              <input
                type="radio"
                checked={options.software_type === 'retail'}
                onChange={() => updateOption('software_type', 'retail')}
                disabled={isBusy}
                className="border-slate-300 text-primary-600 focus:ring-primary-500"
                name="software_type"
                value="retail"
              />
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                {t('settings.legacy_software_retail')}
              </span>
            </label>
            <label className="flex items-center space-x-2 rtl:space-x-reverse cursor-pointer">
              <input
                type="radio"
                checked={options.software_type === 'wholesale'}
                onChange={() => updateOption('software_type', 'wholesale')}
                disabled={isBusy}
                className="border-slate-300 text-primary-600 focus:ring-primary-500"
                name="software_type"
                value="wholesale"
              />
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                {t('settings.legacy_software_wholesale')}
              </span>
            </label>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
            {t('settings.select_data')}
          </h3>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center space-x-2 rtl:space-x-reverse cursor-pointer">
              <input
                type="checkbox"
                checked={options.suppliers}
                onChange={(e) => updateOption('suppliers', e.target.checked)}
                disabled={isBusy}
                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                {t('settings.legacy_suppliers')}
              </span>
            </label>
            <label className="flex items-center space-x-2 rtl:space-x-reverse cursor-pointer">
              <input
                type="checkbox"
                checked={options.clients}
                onChange={(e) => updateOption('clients', e.target.checked)}
                disabled={isBusy}
                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                {t('settings.legacy_clients')}
              </span>
            </label>
            <label className="flex items-center space-x-2 rtl:space-x-reverse cursor-pointer">
              <input
                type="checkbox"
                checked={options.products}
                onChange={(e) => updateOption('products', e.target.checked)}
                disabled={isBusy}
                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                {t('settings.legacy_products')}
              </span>
            </label>
            <label className="flex items-center space-x-2 rtl:space-x-reverse cursor-pointer">
              <input
                type="checkbox"
                checked={options.purchases}
                onChange={(e) => updateOption('purchases', e.target.checked)}
                disabled={isBusy}
                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                {t('settings.legacy_purchases')}
              </span>
            </label>
            <label className="flex items-center space-x-2 rtl:space-x-reverse cursor-pointer">
              <input
                type="checkbox"
                checked={options.sales}
                onChange={(e) => updateOption('sales', e.target.checked)}
                disabled={isBusy}
                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                {t('settings.legacy_sales')}
              </span>
            </label>
          </div>
        </div>

        {/* Directory or ZIP Selection */}
        <div className="space-y-3">
          <div className="border-2 border-dashed border-slate-200/90 dark:border-slate-700 rounded-2xl p-8 text-center hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors relative">
            <input
              type="file"
              // @ts-ignore
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleDirectorySelect}
              disabled={isBusy}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              title={t('settings.legacy_select_folder_title')}
            />

            {isBusy ? (
              <div className="flex flex-col items-center">
                <Loader2 className="h-10 w-10 text-primary-600 animate-spin mb-3" />
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {isZipping
                    ? `${t('settings.zipping')} ${progress}%`
                    : isPreviewing
                    ? t('settings.legacy_previewing')
                    : t('settings.uploading')}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <UploadCloud className="h-10 w-10 text-slate-400 mb-3" />
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('settings.click_select')}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('settings.contains_dbf')}</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-center gap-3 text-xs text-slate-400">
            <span className="h-px bg-slate-200 dark:bg-slate-700 flex-1" />
            <span>{t('settings.legacy_or')}</span>
            <span className="h-px bg-slate-200 dark:bg-slate-700 flex-1" />
          </div>

          <div className="flex items-center justify-center">
            <label className={cn(
              'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold shadow-2xs transition-all cursor-pointer',
              isBusy && 'opacity-50 pointer-events-none'
            )}>
              <UploadCloud size={15} className="text-slate-500" />
              <span>{t('settings.legacy_upload_zip')}</span>
              <input
                type="file"
                accept=".zip"
                onChange={handleZipFileSelect}
                disabled={isBusy}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {error && (
          <div className="bg-danger-light text-danger border border-danger/30 p-4 rounded-xl text-sm font-medium">
            {error}
          </div>
        )}

        {/* ── Pre-Import Preview Report (Dry Run) ── */}
        {previewReport && (
          <div className="bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/60 rounded-2xl p-6 space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-sky-600 text-white">
                    Dry Run
                  </span>
                  <h3 className="text-sm font-bold text-sky-950 dark:text-sky-200">
                    {t('settings.legacy_preview_title')}
                  </h3>
                </div>
                <p className="text-xs text-sky-800/80 dark:text-sky-300/80 mt-1">
                  {t('settings.legacy_preview_subtitle')}
                </p>
              </div>

              {pendingFile && (
                <button
                  type="button"
                  onClick={() => runPreview(pendingFile.blob, pendingFile.filename)}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-300 dark:border-sky-800 text-sky-800 dark:text-sky-300 hover:bg-sky-100/60 dark:hover:bg-sky-900/50 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <RefreshCw size={13} className={cn(isPreviewing && 'animate-spin')} />
                  {t('settings.legacy_refresh_preview')}
                </button>
              )}
            </div>

            {/* Counts Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-sky-100 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('settings.legacy_products')}
                </div>
                <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  {previewReport.counts?.products ?? previewReport.products_imported}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-sky-100 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('settings.stock_imported')}
                </div>
                <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  {previewReport.counts?.stock_units ?? previewReport.stock_units_imported}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-sky-100 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('settings.legacy_clients')}
                </div>
                <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  {previewReport.counts?.clients ?? previewReport.clients_imported}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-sky-100 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('settings.legacy_suppliers')}
                </div>
                <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  {previewReport.counts?.suppliers ?? previewReport.suppliers_imported}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-sky-100 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('settings.legacy_purchases')}
                </div>
                <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  {previewReport.counts?.purchase_orders ?? previewReport.purchase_orders_imported}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-sky-100 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('settings.legacy_sales')}
                </div>
                <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  {previewReport.counts?.sales ?? previewReport.sales_imported}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-sky-100 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('settings.refunds_imported')}
                </div>
                <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  {previewReport.counts?.refunds ?? previewReport.refunds_imported}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-sky-100 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('settings.legacy_defects_imported')}
                </div>
                <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  {previewReport.counts?.defects ?? previewReport.defects_imported}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-sky-100 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('settings.legacy_cheques')}
                </div>
                <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  {previewReport.counts?.cheques ?? previewReport.cheques_imported ?? 0}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-sky-100 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('settings.legacy_part_payments')}
                </div>
                <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  {previewReport.counts?.part_payments ?? previewReport.part_payments_imported ?? 0}
                </div>
              </div>
            </div>

            {/* Financial Totals */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Coins size={14} className="text-primary-600 dark:text-primary-400" />
                {t('settings.legacy_totals_title')}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-sky-100 dark:border-slate-800">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('settings.legacy_total_stock_value')}
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                    {formatDZD(previewReport.totals?.stock_value ?? 0)}
                  </div>
                  {previewReport.totals?.stock_retail_value && (
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                      {t('settings.legacy_sales')} : {formatDZD(previewReport.totals.stock_retail_value)}
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-sky-100 dark:border-slate-800">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('settings.legacy_total_client_debts')}
                  </div>
                  <div className="text-sm font-bold text-amber-700 dark:text-amber-400 mt-0.5">
                    {formatDZD(previewReport.totals?.client_debts ?? 0)}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-sky-100 dark:border-slate-800">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('settings.legacy_total_client_credits')}
                  </div>
                  <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                    {formatDZD(previewReport.totals?.client_credits ?? 0)}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-sky-100 dark:border-slate-800">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('settings.legacy_total_supplier_debts')}
                  </div>
                  <div className="text-sm font-bold text-rose-700 dark:text-rose-400 mt-0.5">
                    {formatDZD(previewReport.totals?.supplier_debts ?? 0)}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-sky-100 dark:border-slate-800">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('settings.legacy_total_supplier_credits')}
                  </div>
                  <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                    {formatDZD(previewReport.totals?.supplier_credits ?? 0)}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-sky-100 dark:border-slate-800">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('settings.legacy_total_unsettled_cheques')}
                  </div>
                  <div className="text-sm font-bold text-indigo-700 dark:text-indigo-400 mt-0.5">
                    {formatDZD(previewReport.totals?.unsettled_cheques ?? 0)}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-sky-100 dark:border-slate-800">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('settings.legacy_total_part_payments')}
                  </div>
                  <div className="text-sm font-bold text-amber-700 dark:text-amber-400 mt-0.5">
                    {formatDZD(previewReport.totals?.part_payments ?? 0)}
                  </div>
                </div>
              </div>
            </div>

            {/* Warnings Section */}
            {previewReport.warnings && previewReport.warnings.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/60 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-amber-900 dark:text-amber-200">
                  <div className="flex items-center gap-1.5">
                    <ShieldAlert size={15} className="text-amber-600 dark:text-amber-400" />
                    {t('settings.legacy_warnings_title', { count: previewReport.warnings.length })}
                  </div>
                  <div className="flex gap-2 text-[10px]">
                    {Number(previewReport.warning_counts?.unknown_sizes || 0) > 0 && (
                      <span className="px-2 py-0.5 rounded bg-amber-200/70 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200">
                        {t('settings.legacy_warn_unknown_sizes', { count: previewReport.warning_counts?.unknown_sizes })}
                      </span>
                    )}
                    {Number(previewReport.warning_counts?.products_without_price || 0) > 0 && (
                      <span className="px-2 py-0.5 rounded bg-amber-200/70 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200">
                        {t('settings.legacy_warn_no_price', { count: previewReport.warning_counts?.products_without_price })}
                      </span>
                    )}
                    {Number(previewReport.warning_counts?.guessed_size_ranges || 0) > 0 && (
                      <span className="px-2 py-0.5 rounded bg-amber-200/70 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200">
                        {t('settings.legacy_warn_guessed_sizes', { count: previewReport.warning_counts?.guessed_size_ranges })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="max-h-40 overflow-y-auto space-y-1 text-[11px] text-amber-900/90 dark:text-amber-300/90 font-mono pr-1">
                  {previewReport.warnings.slice(0, 100).map((w, idx) => (
                    <div key={idx} className="leading-tight">
                      • {w}
                    </div>
                  ))}
                  {previewReport.warnings.length > 100 && (
                    <div className="text-[10px] italic text-amber-700 dark:text-amber-400 pt-1">
                      ... et {previewReport.warnings.length - 100} autres avertissements.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SQLite Writer Lock Notice */}
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <span>{t('settings.legacy_sqlite_lock_warning')}</span>
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-sky-200/80 dark:border-sky-900/60">
              <button
                type="button"
                onClick={() => {
                  setPreviewReport(null);
                  setPendingFile(null);
                }}
                disabled={isExecuting}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors cursor-pointer"
              >
                {t('common.cancel', 'Annuler')}
              </button>

              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={isExecuting}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold shadow-xs hover:shadow-primary-500/20 transition-all cursor-pointer disabled:opacity-50"
              >
                {isExecuting ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    {t('settings.uploading')}
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={15} />
                    {t('settings.legacy_confirm_import')}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── Final Import Result ── */}
        {result && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <h3 className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{t('settings.import_completed')}</h3>
            </div>
            <ul className="text-xs text-emerald-700 dark:text-emerald-300 list-disc list-inside space-y-1.5 ml-1 font-medium">
              <li>{t('settings.products_imported')} <strong>{result.products_imported}</strong></li>
              <li>{t('settings.stock_imported')} <strong>{result.stock_units_imported}</strong></li>
              <li>{t('settings.new_suppliers')} <strong>{result.suppliers_imported}</strong></li>
              <li>{t('settings.new_clients')} <strong>{result.clients_imported}</strong></li>
              {result.purchase_orders_imported > 0 && (
                <li>{t('settings.legacy_purchase_orders_imported')} <strong>{result.purchase_orders_imported}</strong></li>
              )}
              <li>{t('settings.sales_imported')} <strong>{result.sales_imported}</strong></li>
              <li>{t('settings.refunds_imported')} <strong>{result.refunds_imported}</strong></li>
              {result.defects_imported > 0 && (
                <li>{t('settings.legacy_defects_imported')} <strong>{result.defects_imported}</strong></li>
              )}
              {(result.cheques_imported ?? 0) > 0 && (
                <li>{t('settings.legacy_cheques_imported')} <strong>{result.cheques_imported}</strong></li>
              )}
              {(result.part_payments_imported ?? 0) > 0 && (
                <li>{t('settings.legacy_part_payments_imported')} <strong>{result.part_payments_imported}</strong></li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
