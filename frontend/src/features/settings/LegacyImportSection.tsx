import React, { useState } from 'react';
import JSZip from 'jszip';
import api from '@/lib/api';
import { UploadCloud, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const LegacyImportSection: React.FC = () => {
  const { t } = useTranslation();
  const [isZipping, setIsZipping] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

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
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-medium">{t("settings.legacy_migration")}</h2>
        <p className="text-sm text-gray-500 mt-1">
          {t("settings.legacy_desc")}
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-md p-4 flex gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-medium text-amber-800">{t("settings.warning_proceed")}</h3>
          <p className="text-sm text-amber-700 mt-1">
            {t("settings.warning_desc")}
          </p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-md p-4">
        <h3 className="text-sm font-medium mb-3">{t("settings.select_data")}</h3>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center space-x-2">
            <input type="checkbox" checked={options.suppliers} onChange={(e) => setOptions({...options, suppliers: e.target.checked})} disabled={isZipping || isUploading} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            <span className="text-sm">{t("settings.legacy_suppliers")}</span>
          </label>
          <label className="flex items-center space-x-2">
            <input type="checkbox" checked={options.clients} onChange={(e) => setOptions({...options, clients: e.target.checked})} disabled={isZipping || isUploading} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            <span className="text-sm">{t("settings.legacy_clients")}</span>
          </label>
          <label className="flex items-center space-x-2">
            <input type="checkbox" checked={options.products} onChange={(e) => setOptions({...options, products: e.target.checked})} disabled={isZipping || isUploading} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            <span className="text-sm">{t("settings.legacy_products")}</span>
          </label>
          <label className="flex items-center space-x-2">
            <input type="checkbox" checked={options.sales} onChange={(e) => setOptions({...options, sales: e.target.checked})} disabled={isZipping || isUploading} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            <span className="text-sm">{t("settings.legacy_sales")}</span>
          </label>
        </div>
      </div>

      <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:bg-gray-50 transition-colors relative">
        <input
          type="file"
          // @ts-ignore - webkitdirectory is a non-standard attribute but widely supported
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
            <Loader2 className="h-10 w-10 text-primary-500 animate-spin mb-4" />
            <p className="text-sm font-medium text-gray-900">
              {isZipping ? `${t("settings.zipping")} ${progress}%` : t("settings.uploading")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <UploadCloud className="h-10 w-10 text-gray-400 mb-4" />
            <p className="text-sm font-medium text-gray-900">{t("settings.click_select")}</p>
            <p className="text-xs text-gray-500 mt-1">{t("settings.contains_dbf")}</p>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-md text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-green-50 border border-green-200 rounded-md p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <h3 className="text-sm font-medium text-green-800">{t("settings.import_completed")}</h3>
          </div>
          <ul className="text-sm text-green-700 list-disc list-inside space-y-1 ml-1">
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
  );
};
