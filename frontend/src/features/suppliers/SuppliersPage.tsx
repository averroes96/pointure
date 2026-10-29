import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, X, Check, Pencil, Eye, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api, { formatDZD, getApiError, type PaginatedResponse } from "@/lib/api";
import type { Supplier } from "@/types";
import { cn } from "@/lib/utils";
import ImportModal from "@/components/ui/ImportModal";

interface SupplierFormData {
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  origin_country: string;
}

const EMPTY_FORM: SupplierFormData = {
  name: "",
  contact_name: "",
  phone: "",
  email: "",
  origin_country: "",
};

function SupplierFormModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<SupplierFormData>(EMPTY_FORM);
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (data: SupplierFormData) =>
      api.post("/suppliers/", data).then((r) => r.data),
    onSuccess: () => {
      onSuccess();
      onClose();
    },
    onError: (err) => setError(getApiError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) {
      setError(t("supplier.error_name_required"));
      return;
    }
    mutation.mutate(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/60">
          <div>
            <h2 className="text-base font-bold text-slate-900 font-sans">{t("supplier.new")}</h2>
            <p className="text-xs text-slate-500 mt-0.5">Ajouter un nouveau fournisseur partenaire</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs px-3.5 py-2.5 font-medium">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("supplier.name_required")}</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20"
              placeholder={t("supplier.name")}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("supplier.contact")}</label>
            <input
              type="text"
              value={form.contact_name}
              onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
              className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20"
              placeholder={t("supplier.contact_name")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("supplier.phone")}</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 font-mono text-sm"
                placeholder="0550 000 000"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("supplier.email")}</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs"
                placeholder="contact@fournisseur.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("supplier.origin_country")}</label>
            <input
              type="text"
              value={form.origin_country}
              onChange={(e) => setForm({ ...form, origin_country: e.target.value })}
              className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20"
              placeholder={t("supplier.origin_placeholder")}
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary rounded-xl"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn-primary rounded-xl shadow-xs shadow-primary-500/20"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface EditRowProps {
  supplier: Supplier;
  onDone: () => void;
}

function EditRow({ supplier, onDone }: EditRowProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SupplierFormData>({
    name: supplier.name,
    contact_name: supplier.contact_name,
    phone: supplier.phone,
    email: supplier.email,
    origin_country: supplier.origin_country,
  });
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (data: SupplierFormData) =>
      api.patch(`/suppliers/${supplier.id}/`, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      onDone();
    },
    onError: (err) => setError(getApiError(err)),
  });

  function handleSave() {
    setError("");
    if (!form.name.trim()) {
      setError(t("supplier.error_name_required"));
      return;
    }
    mutation.mutate(form);
  }

  return (
    <>
      <tr className="bg-primary-50/40 border-b border-primary-100">
        <td className="px-4 py-2.5">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="form-input py-1 text-xs rounded-lg border-slate-300 bg-white shadow-2xs font-medium"
            placeholder={t("supplier.name")}
          />
        </td>
        <td className="px-4 py-2.5">
          <input
            type="text"
            value={form.contact_name}
            onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
            className="form-input py-1 text-xs rounded-lg border-slate-300 bg-white shadow-2xs"
            placeholder={t("supplier.contact")}
          />
        </td>
        <td className="px-4 py-2.5">
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="form-input py-1 text-xs rounded-lg border-slate-300 bg-white shadow-2xs font-mono"
            placeholder={t("supplier.phone")}
          />
        </td>
        <td className="px-4 py-2.5">
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="form-input py-1 text-xs rounded-lg border-slate-300 bg-white shadow-2xs"
            placeholder={t("supplier.email")}
          />
        </td>
        <td className="px-4 py-2.5">
          <input
            type="text"
            value={form.origin_country}
            onChange={(e) => setForm({ ...form, origin_country: e.target.value })}
            className="form-input py-1 text-xs rounded-lg border-slate-300 bg-white shadow-2xs"
            placeholder={t("supplier.origin_country")}
          />
        </td>
        <td className="px-4 py-2.5 text-end font-mono font-medium text-slate-500 tabular-nums">
          {formatDZD(supplier.outstanding_balance)} DZD
        </td>
        <td className="px-4 py-2.5">
          <span className={cn(
            "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-semibold",
            supplier.is_active
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200/80"
              : "bg-slate-100 text-slate-600 border border-slate-200"
          )}>
            {supplier.is_active ? t("supplier.active") : t("supplier.inactive")}
          </span>
        </td>
        <td className="px-4 py-2.5 text-end">
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={handleSave}
              disabled={mutation.isPending}
              className="p-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors shadow-2xs"
              title={t("common.save")}
            >
              <Check size={13} />
            </button>
            <button
              onClick={onDone}
              className="p-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
              title={t("common.cancel")}
            >
              <X size={13} />
            </button>
          </div>
        </td>
      </tr>
      {error && (
        <tr className="bg-rose-50/60 border-b border-rose-100">
          <td colSpan={8} className="px-4 py-1.5 text-xs font-medium text-rose-600">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}

export default function SuppliersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<PaginatedResponse<Supplier>>({
    queryKey: ["suppliers", { search }],
    queryFn: () =>
      api.get(`/suppliers/?search=${search}`).then((r) => r.data),
  });

  const suppliers = data?.results ?? [];

  function handleCreated() {
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
  }

  return (
    <div className="space-y-5">
      {showImport && (
        <ImportModal
          entity="suppliers"
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["suppliers"] });
            setShowImport(false);
          }}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{t("supplier.suppliers")}</h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            <span className="font-mono font-semibold text-slate-700">{data?.count ?? 0}</span> fournisseurs enregistrés
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={() => setShowImport(true)} className="btn-secondary rounded-xl">
            <Upload size={15} />
            Importer CSV
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary rounded-xl shadow-xs shadow-primary-500/20">
            <Plus size={16} />
            {t("supplier.new")}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          data-shortcut-search="true"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-input ps-9 pe-12 bg-white border-slate-200/90 shadow-2xs rounded-xl focus:ring-primary-500/20"
          placeholder={t("supplier.search_supplier")}
        />
        <kbd className="absolute end-3 top-1/2 -translate-y-1/2 text-2xs font-mono font-semibold bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md shadow-2xs pointer-events-none">
          F2
        </kbd>
      </div>

      {/* Table Card */}
      <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/70">
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("supplier.name")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("supplier.contact")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("supplier.phone")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("supplier.email")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("supplier.origin_country")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("supplier.balance_due")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("supplier.active")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400 text-sm">{t("common.loading")}</td>
                </tr>
              )}
              {!isLoading && suppliers.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400 text-sm">Aucun fournisseur trouvé.</td>
                </tr>
              )}
              {suppliers.map((supplier) =>
                editingId === supplier.id ? (
                  <EditRow
                    key={supplier.id}
                    supplier={supplier}
                    onDone={() => setEditingId(null)}
                  />
                ) : (
                  <tr key={supplier.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3.5">
                      <Link
                        to={`/suppliers/${supplier.id}`}
                        className="font-semibold text-slate-900 hover:text-primary-600 transition-colors font-sans"
                      >
                        {supplier.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 text-sm">{supplier.contact_name || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3.5 text-slate-600 text-sm font-mono">{supplier.phone || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3.5 text-slate-500 text-xs font-mono">{supplier.email || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3.5">
                      {supplier.origin_country ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200/60">
                          {supplier.origin_country}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-end">
                      <span
                        className={cn(
                          "font-mono font-semibold tabular-nums text-sm",
                          parseFloat(supplier.outstanding_balance) > 0
                            ? "text-rose-600"
                            : "text-slate-400"
                        )}
                      >
                        {formatDZD(supplier.outstanding_balance)} <span className="text-2xs font-normal text-slate-400">DZD</span>
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-semibold",
                          supplier.is_active
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200/80"
                            : "bg-slate-100 text-slate-600 border border-slate-200"
                        )}
                      >
                        <span className={cn("w-1.5 h-1.5 rounded-full", supplier.is_active ? "bg-emerald-500" : "bg-slate-400")} />
                        {supplier.is_active ? t("supplier.active") : t("supplier.inactive")}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-end">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to={`/suppliers/${supplier.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg text-primary-700 bg-primary-50/70 hover:bg-primary-100/70 transition-colors"
                        >
                          <Eye size={13} />
                          {t("common.view")}
                        </Link>
                        <button
                          onClick={() => setEditingId(supplier.id)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                          title={t("common.edit")}
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <SupplierFormModal
          onClose={() => setShowModal(false)}
          onSuccess={handleCreated}
        />
      )}
    </div>
  );
}
