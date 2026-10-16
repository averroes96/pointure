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
import { cn } from '@/lib/utils';

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
    purchases: true,
    sales: true,
    software_type: 'retail', // 'retail' or 'wholesale'
    easy_mode: true, // true = Easy Mode (1 product = 1 SKU with real stock), false = expand sizes
  });

  const uploadZipBlob = async (blob: Blob | File, filename = 'legacy.zip') => {
    setIsZipping(false);
    setIsUploading(true);
    setProgress(100);

    const formData = new FormData();
    formData.append('zip_file', blob, filename);
    formData.append('options', JSON.stringify(options));

    const response = await api.post('/core/legacy-import/', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    setResult(response.data.stats);
  };

  const handleZipFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setResult(null);
    setIsZipping(false);
    setIsUploading(true);

    try {
      await uploadZipBlob(file, file.name);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Une erreur est survenue lors de l\'importation.');
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleDirectorySelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setError(null);
    setResult(null);
    setIsZipping(true);
    setProgress(0);

    try {
      // If user selected a .zip file via the selector
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
        await uploadZipBlob(files[0], files[0].name);
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
        throw new Error('Aucun fichier .DBF trouvé. Veuillez sélectionner le dossier contenant vos fichiers .DBF ou une archive .ZIP.');
      }

      // Read each file buffer individually to detect and report locked files specifically
      for (let i = 0; i < dbfFiles.length; i++) {
        const file = dbfFiles[i];
        try {
          const buffer = await file.arrayBuffer();
          zip.file(file.name, buffer);
          setProgress(Math.round(((i + 1) / dbfFiles.length) * 45));
        } catch (readErr: any) {
          throw new Error(
            `Impossible de lire le fichier "${file.name}" (accès verrouillé par Windows). L'ancien logiciel de caisse est probablement encore ouvert en arrière-plan. Fermez l'ancien logiciel, ou copiez le dossier sur votre Bureau, ou compressez-le en fichier .ZIP.`
          );
        }
      }

      setProgress(50);

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        setProgress(50 + Math.floor(meta.percent / 2));
      });

      await uploadZipBlob(zipBlob, 'legacy.zip');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Une erreur est survenue lors de l\'importation.');
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

        {/* Inventory Management Mode */}
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-3">Mode de gestion du stock (Articles)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className={cn(
              "p-3 rounded-lg border cursor-pointer transition-all flex items-start gap-3",
              options.easy_mode ? "border-primary-500 bg-primary-500/5 ring-1 ring-primary-500/20" : "border-border hover:border-border-hover bg-surface/50"
            )}>
              <input
                type="radio"
                name="easy_mode"
                checked={options.easy_mode}
                onChange={() => setOptions({ ...options, easy_mode: true })}
                disabled={isZipping || isUploading}
                className="mt-0.5 border-border text-primary-600 focus:ring-primary-500"
              />
              <div>
                <div className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                  Mode Simple (Recommandé)
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600">Par défaut</span>
                </div>
                <p className="text-[11px] text-text-muted mt-0.5">
                  1 article = 1 référence directe avec son stock réel exact. Encaissement 1-clic rapide au POS sans sélection de pointures.
                </p>
              </div>
            </label>

            <label className={cn(
              "p-3 rounded-lg border cursor-pointer transition-all flex items-start gap-3",
              !options.easy_mode ? "border-primary-500 bg-primary-500/5 ring-1 ring-primary-500/20" : "border-border hover:border-border-hover bg-surface/50"
            )}>
              <input
                type="radio"
                name="easy_mode"
                checked={!options.easy_mode}
                onChange={() => setOptions({ ...options, easy_mode: false })}
                disabled={isZipping || isUploading}
                className="mt-0.5 border-border text-primary-600 focus:ring-primary-500"
              />
              <div>
                <div className="text-xs font-bold text-text-primary">
                  Mode Variantes (Découper par tailles)
                </div>
                <p className="text-[11px] text-text-muted mt-0.5">
                  Génère une grille de pointures (36–41 / 40–45) et répartit le stock estimé sur chaque taille.
                </p>
              </div>
            </label>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-3">Software Version</h3>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="radio" checked={options.software_type === 'retail'} onChange={() => setOptions({...options, software_type: 'retail'})} disabled={isZipping || isUploading} className="border-border text-primary-600 focus:ring-primary-500" name="software_type" value="retail" />
              <span className="text-xs font-medium text-text-primary">Retail (Standard)</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="radio" checked={options.software_type === 'wholesale'} onChange={() => setOptions({...options, software_type: 'wholesale'})} disabled={isZipping || isUploading} className="border-border text-primary-600 focus:ring-primary-500" name="software_type" value="wholesale" />
              <span className="text-xs font-medium text-text-primary">Wholesale</span>
            </label>
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
              <input type="checkbox" checked={options.purchases} onChange={(e) => setOptions({...options, purchases: e.target.checked})} disabled={isZipping || isUploading} className="rounded border-border text-primary-600 focus:ring-primary-500" />
              <span className="text-xs font-medium text-text-primary">Bons d'Achat & Réceptions (ACHAT)</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" checked={options.sales} onChange={(e) => setOptions({...options, sales: e.target.checked})} disabled={isZipping || isUploading} className="rounded border-border text-primary-600 focus:ring-primary-500" />
              <span className="text-xs font-medium text-text-primary">{t("settings.legacy_sales")}</span>
            </label>
          </div>
        </div>

        <div className="space-y-3">
          <div className="border-2 border-dashed border-border rounded-2xl p-8 text-center hover:bg-surface/40 transition-colors relative">
            <input
              type="file"
              // @ts-ignore
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleDirectorySelect}
              disabled={isZipping || isUploading}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              title="Sélectionner le dossier contenant vos fichiers .DBF"
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

          <div className="flex items-center justify-center gap-3 text-xs text-text-muted">
            <span className="h-px bg-border flex-1" />
            <span>OU</span>
            <span className="h-px bg-border flex-1" />
          </div>

          <div className="flex items-center justify-center">
            <label className={cn(
              "btn-secondary text-xs font-semibold py-2 px-4 rounded-xl cursor-pointer flex items-center gap-2",
              (isZipping || isUploading) && "opacity-50 pointer-events-none"
            )}>
              <UploadCloud size={15} />
              <span>Téléverser une archive .ZIP (ex: export.zip)</span>
              <input
                type="file"
                accept=".zip"
                onChange={handleZipFileSelect}
                disabled={isZipping || isUploading}
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
              {result.purchase_orders_imported > 0 && (
                <li>Bons d'achat / réceptions importés : <strong>{result.purchase_orders_imported}</strong></li>
              )}
              <li>{t("settings.sales_imported")} <strong>{result.sales_imported}</strong></li>
              <li>{t("settings.refunds_imported")} <strong>{result.refunds_imported}</strong></li>
              {result.defects_imported > 0 && (
                <li>Articles défectueux isolés : <strong>{result.defects_imported}</strong></li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
