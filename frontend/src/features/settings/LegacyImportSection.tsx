import React, { useState } from 'react';
import JSZip from 'jszip';
import api from '@/lib/api';
import {
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FileSpreadsheet,
  Package,
  Users,
  Truck,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import BulkImportWizardModal, { ImportEntityType } from '@/components/import/BulkImportWizardModal';

export const LegacyImportSection: React.FC = () => {
  const { t } = useTranslation();
  const [isZipping, setIsZipping] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [activeWizardEntity, setActiveWizardEntity] = useState<ImportEntityType | null>(null);

  const [options, setOptions] = useState({
    suppliers: true,
    clients: true,
    products: true,
    sales: true,
  });

  const handleDirectorySelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setError(null);
    setResult(null);
    setIsZipping(true);
    setProgress(0);

    try {
      const zip = new JSZip();
      
      let dbfCount = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.toLowerCase().endsWith('.dbf')) {
          zip.file(file.name, file);
          dbfCount++;
        }
      }

      if (dbfCount === 0) {
        throw new Error('No .DBF files found in the selected folder. Please select the /LEGACY/ folder.');
      }

      setProgress(50);

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        setProgress(50 + Math.floor(meta.percent / 2));
      });

      setIsZipping(false);
      setIsUploading(true);

      const formData = new FormData();
      formData.append('zip_file', zipBlob, 'legacy.zip');
      formData.append('options', JSON.stringify(options));

      const response = await api.post('/core/legacy-import/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        }
      });

      setResult(response.data.stats);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'An error occurred during import.');
    } finally {
      setIsZipping(false);
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

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
      <div className="p-6 rounded-2xl bg-gradient-to-br from-primary-500/10 via-primary-500/5 to-surface border border-primary-500/30 shadow-sm space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-primary-500 text-white shadow-md shadow-primary-500/20">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-text-primary flex items-center gap-2">
                {t("import_wizard.title")}
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 dark:bg-primary-950 dark:text-primary-300">
                  Nouveau
                </span>
              </h2>
              <p className="text-xs text-text-muted mt-0.5">
                {t("import_wizard.subtitle")}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <button
            type="button"
            onClick={() => setActiveWizardEntity('products')}
            className="flex items-center justify-between p-3.5 rounded-xl bg-card border border-border hover:border-primary-400 hover:shadow-sm transition-all text-start group cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Package className="w-4 h-4 text-primary-500" />
              <div>
                <div className="text-xs font-bold text-text-primary">Produits & Stocks</div>
                <div className="text-[11px] text-text-muted">Excel / CSV</div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-primary-500 group-hover:translate-x-0.5 transition-all" />
          </button>

          <button
            type="button"
            onClick={() => setActiveWizardEntity('clients')}
            className="flex items-center justify-between p-3.5 rounded-xl bg-card border border-border hover:border-primary-400 hover:shadow-sm transition-all text-start group cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Users className="w-4 h-4 text-primary-500" />
              <div>
                <div className="text-xs font-bold text-text-primary">Clients</div>
                <div className="text-[11px] text-text-muted">Excel / CSV</div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-primary-500 group-hover:translate-x-0.5 transition-all" />
          </button>

          <button
            type="button"
            onClick={() => setActiveWizardEntity('suppliers')}
            className="flex items-center justify-between p-3.5 rounded-xl bg-card border border-border hover:border-primary-400 hover:shadow-sm transition-all text-start group cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Truck className="w-4 h-4 text-primary-500" />
              <div>
                <div className="text-xs font-bold text-text-primary">Fournisseurs</div>
                <div className="text-[11px] text-text-muted">Excel / CSV</div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-primary-500 group-hover:translate-x-0.5 transition-all" />
          </button>
        </div>
      </div>

      {/* Legacy DBF Migration Section */}
      <div className="space-y-5 pt-2">
        <div className="border-t border-border pt-6">
          <h2 className="text-base font-bold text-text-primary">{t("settings.legacy_migration")}</h2>
          <p className="text-xs text-text-muted mt-1">
            {t("settings.legacy_desc")}
          </p>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400">{t("settings.warning_proceed")}</h3>
            <p className="text-xs text-amber-600/90 dark:text-amber-400/90 mt-1">
              {t("settings.warning_desc")}
            </p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-3">{t("settings.select_data")}</h3>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" checked={options.suppliers} onChange={(e) => setOptions({...options, suppliers: e.target.checked})} disabled={isZipping || isUploading} className="rounded border-border text-primary-600 focus:ring-primary-500" />
              <span className="text-xs font-medium text-text-primary">{t("settings.legacy_suppliers")}</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" checked={options.clients} onChange={(e) => setOptions({...options, clients: e.target.checked})} disabled={isZipping || isUploading} className="rounded border-border text-primary-600 focus:ring-primary-500" />
              <span className="text-xs font-medium text-text-primary">{t("settings.legacy_clients")}</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" checked={options.products} onChange={(e) => setOptions({...options, products: e.target.checked})} disabled={isZipping || isUploading} className="rounded border-border text-primary-600 focus:ring-primary-500" />
              <span className="text-xs font-medium text-text-primary">{t("settings.legacy_products")}</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" checked={options.sales} onChange={(e) => setOptions({...options, sales: e.target.checked})} disabled={isZipping || isUploading} className="rounded border-border text-primary-600 focus:ring-primary-500" />
              <span className="text-xs font-medium text-text-primary">{t("settings.legacy_sales")}</span>
            </label>
          </div>
        </div>

        <div className="border-2 border-dashed border-border rounded-2xl p-10 text-center hover:bg-surface/40 transition-colors relative">
          <input
            type="file"
            // @ts-ignore
            webkitdirectory=""
            directory=""
            multiple
            onChange={handleDirectorySelect}
            disabled={isZipping || isUploading}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            title="Select /LEGACY folder"
          />
          
          {isZipping || isUploading ? (
            <div className="flex flex-col items-center">
              <Loader2 className="h-10 w-10 text-primary-500 animate-spin mb-3" />
              <p className="text-sm font-medium text-text-primary">
                {isZipping ? `${t("settings.zipping")} ${progress}%` : t("settings.uploading")}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <UploadCloud className="h-10 w-10 text-text-muted mb-3" />
              <p className="text-sm font-semibold text-text-primary">{t("settings.click_select")}</p>
              <p className="text-xs text-text-muted mt-1">{t("settings.contains_dbf")}</p>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-danger-light text-danger border border-danger/30 p-4 rounded-xl text-sm font-medium">
            {error}
          </div>
        )}

        {result && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <h3 className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{t("settings.import_completed")}</h3>
            </div>
            <ul className="text-xs text-emerald-700 dark:text-emerald-300 list-disc list-inside space-y-1.5 ml-1 font-medium">
              <li>{t("settings.products_imported")} <strong>{result.products_imported}</strong></li>
              <li>{t("settings.stock_imported")} <strong>{result.stock_units_imported}</strong></li>
              <li>{t("settings.new_suppliers")} <strong>{result.suppliers_imported}</strong></li>
              <li>{t("settings.new_clients")} <strong>{result.clients_imported}</strong></li>
              <li>{t("settings.sales_imported")} <strong>{result.sales_imported}</strong></li>
              <li>{t("settings.refunds_imported")} <strong>{result.refunds_imported}</strong></li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
