import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, X, Check, Pencil } from "lucide-react";
import api, { formatDZD, getApiError, type PaginatedResponse } from "@/lib/api";
import type { Supplier } from "@/types";
import { cn } from "@/lib/utils";

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
      setError("Le nom du fournisseur est obligatoire.");
      return;
    }
    mutation.mutate(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="card-header">
          <h2 className="font-semibold text-text-primary">Nouveau fournisseur</h2>
          <button onClick={onClose} className="btn-ghost btn-sm p-1">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="card-body space-y-4">
          {error && (
            <div className="rounded-md bg-danger-light text-danger text-sm px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="form-label">Nom *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="form-input"
              placeholder="Nom du fournisseur"
              required
            />
          </div>

          <div>
            <label className="form-label">Contact</label>
            <input
              type="text"
              value={form.contact_name}
              onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
              className="form-input"
              placeholder="Nom du contact"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Téléphone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="form-input"
                placeholder="0550 000 000"
              />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="form-input"
                placeholder="contact@example.com"
              />
            </div>
          </div>

          <div>
            <label className="form-label">Pays d'origine</label>
            <input
              type="text"
              value={form.origin_country}
              onChange={(e) => setForm({ ...form, origin_country: e.target.value })}
              className="form-input"
              placeholder="Chine, Turquie..."
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Annuler
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Enregistrement..." : "Enregistrer"}
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
      setError("Le nom est obligatoire.");
      return;
    }
    mutation.mutate(form);
  }

  return (
    <>
      <tr className="bg-blue-50">
        <td>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="form-input py-1 text-xs"
          />
        </td>
        <td>
          <input
            type="text"
            value={form.contact_name}
            onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
            className="form-input py-1 text-xs"
          />
        </td>
        <td>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="form-input py-1 text-xs"
          />
        </td>
        <td>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="form-input py-1 text-xs"
          />
        </td>
        <td>
          <input
            type="text"
            value={form.origin_country}
            onChange={(e) => setForm({ ...form, origin_country: e.target.value })}
            className="form-input py-1 text-xs"
          />
        </td>
        <td className="text-end font-mono text-text-muted">
          {formatDZD(supplier.outstanding_balance)} DZD
        </td>
        <td>
          <span className={cn("badge", supplier.is_active ? "badge-success" : "badge-neutral")}>
            {supplier.is_active ? "Actif" : "Inactif"}
          </span>
        </td>
        <td>
          <div className="flex items-center gap-1">
            <button
              onClick={handleSave}
              disabled={mutation.isPending}
              className="btn-primary btn-sm p-1.5"
              title="Sauvegarder"
            >
              <Check size={13} />
            </button>
            <button onClick={onDone} className="btn-secondary btn-sm p-1.5" title="Annuler">
              <X size={13} />
            </button>
          </div>
        </td>
      </tr>
      {error && (
        <tr className="bg-blue-50">
          <td colSpan={8} className="px-3 py-1 text-xs text-danger">{error}</td>
        </tr>
      )}
    </>
  );
}

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Fournisseurs</h1>
          <p className="text-sm text-text-muted">{data?.count ?? 0} fournisseur(s)</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary">
          <Plus size={16} />
          Nouveau fournisseur
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-input ps-9"
          placeholder="Nom, contact, pays..."
        />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Contact</th>
                <th>Téléphone</th>
                <th>Email</th>
                <th>Pays d'origine</th>
                <th className="text-end">Solde dû</th>
                <th>Actif</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-text-muted">Chargement...</td>
                </tr>
              )}
              {!isLoading && suppliers.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-text-muted">Aucun fournisseur trouvé.</td>
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
                  <tr key={supplier.id}>
                    <td>
                      <span className="font-medium text-text-primary">{supplier.name}</span>
                    </td>
                    <td className="text-text-muted">{supplier.contact_name || "—"}</td>
                    <td className="text-text-muted">{supplier.phone || "—"}</td>
                    <td className="text-text-muted text-xs">{supplier.email || "—"}</td>
                    <td className="text-text-muted">{supplier.origin_country || "—"}</td>
                    <td className="text-end">
                      <span
                        className={cn(
                          "font-mono font-medium",
                          parseFloat(supplier.outstanding_balance) > 0
                            ? "text-danger"
                            : "text-text-muted"
                        )}
                      >
                        {formatDZD(supplier.outstanding_balance)} DZD
                      </span>
                    </td>
                    <td>
                      <span
                        className={cn(
                          "badge",
                          supplier.is_active ? "badge-success" : "badge-neutral"
                        )}
                      >
                        {supplier.is_active ? "Actif" : "Inactif"}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => setEditingId(supplier.id)}
                        className="btn-ghost btn-sm text-primary-500"
                      >
                        <Pencil size={13} />
                        Modifier
                      </button>
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
