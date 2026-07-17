/**
 * WebhooksPage — /settings/webhooks
 *
 * Manage outbound HTTP webhook endpoints.
 * List configured endpoints, view delivery log per endpoint,
 * create / edit / delete endpoints, send test pings, retry failed deliveries.
 *
 * Requires pro_retail plan or above.
 */
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Webhook, Trash2, Send, ChevronRight,
  CheckCircle2, XCircle, Clock, AlertCircle,
  RefreshCw, Eye, EyeOff, X, Save, Loader2,
} from "lucide-react";
import api, { formatDate, getApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePlan } from "@/hooks/usePlan";

// ── Types ────────────────────────────────────────────────────────────────────

interface EventType {
  value: string;
  label: string;
}

interface WebhookEndpoint {
  id: number;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  delivery_count: number;
  last_delivery_status: string | null;
}

interface WebhookDelivery {
  id: number;
  idempotency_key: string;
  endpoint_name: string;
  endpoint_url: string;
  event_type: string;
  status: "pending" | "delivered" | "failed" | "abandoned";
  attempts: number;
  response_status: number | null;
  response_body: string;
  created_at: string;
  delivered_at: string | null;
  next_attempt_at: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: WebhookDelivery["status"] | string | null }) {
  if (!status) return null;
  const cfg = {
    pending:   { icon: Clock, cls: "text-yellow-600 bg-yellow-50", label: "En attente" },
    delivered: { icon: CheckCircle2, cls: "text-green-700 bg-green-50", label: "Livré" },
    failed:    { icon: XCircle, cls: "text-red-600 bg-red-50", label: "Échoué" },
    abandoned: { icon: AlertCircle, cls: "text-gray-500 bg-gray-100", label: "Abandonné" },
  }[status] ?? { icon: Clock, cls: "text-gray-400 bg-gray-50", label: status };

  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium", cfg.cls)}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

// ── Endpoint Form Modal ───────────────────────────────────────────────────────

interface EndpointFormProps {
  initial?: Partial<WebhookEndpoint>;
  eventTypes: EventType[];
  onClose: () => void;
  onSaved: () => void;
}

function EndpointFormModal({ initial, eventTypes, onClose, onSaved }: EndpointFormProps) {
  const { t } = useTranslation();
  const isEdit = !!initial?.id;
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<string[]>(initial?.events ?? []);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { name, url, events, is_active: isActive };
      if (secret) body.secret = secret;
      if (isEdit) {
        return api.patch(`/webhooks/endpoints/${initial!.id}/`, body);
      }
      if (!secret) throw new Error("Le secret est requis à la création.");
      return api.post("/webhooks/endpoints/", body);
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(getApiError(e)),
  });

  const toggleEvent = (v: string) =>
    setEvents((prev) => prev.includes(v) ? prev.filter((e) => e !== v) : [...prev, v]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-text-primary">
            {isEdit ? "Modifier l'endpoint" : "Nouvel endpoint webhook"}
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Nom</label>
            <input
              className="input w-full"
              placeholder="Comptabilité Algérie"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">URL</label>
            <input
              className="input w-full font-mono text-sm"
              placeholder="https://mon-erp.example.com/webhooks/shodz"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              type="url"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Secret HMAC {isEdit && <span className="text-text-muted font-normal">(laisser vide pour ne pas changer)</span>}
            </label>
            <div className="relative">
              <input
                className="input w-full pr-10 font-mono text-sm"
                placeholder={isEdit ? "••••••••" : "Clé secrète partagée"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                type={showSecret ? "text" : "password"}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                onClick={() => setShowSecret((s) => !s)}
              >
                {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-xs text-text-muted mt-1">
              Utilisé pour signer chaque requête via <code>X-ShoeDZ-Signature: sha256=&lt;hmac&gt;</code>
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Événements</label>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {eventTypes.map((et) => (
                <label key={et.value} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    className="rounded border-border text-accent"
                    checked={events.includes(et.value)}
                    onChange={() => toggleEvent(et.value)}
                  />
                  <span className="text-sm text-text-primary group-hover:text-accent font-mono">{et.value}</span>
                  <span className="text-xs text-text-muted">{et.label}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="rounded border-border text-accent"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span className="text-sm text-text-primary">Actif</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button
            className="btn btn-primary flex items-center gap-2"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !name || !url || events.length === 0}
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {isEdit ? "Enregistrer" : "Créer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delivery Log Panel ────────────────────────────────────────────────────────

function DeliveryLog({ endpoint }: { endpoint: WebhookEndpoint }) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const qc = useQueryClient();

  const { data: deliveries = [], isLoading } = useQuery<WebhookDelivery[]>({
    queryKey: ["webhook-deliveries", endpoint.id, statusFilter],
    queryFn: () =>
      api
        .get(`/webhooks/endpoints/${endpoint.id}/deliveries/`, {
          params: statusFilter ? { status: statusFilter } : {},
        })
        .then((r) => r.data),
    refetchInterval: 15_000,
  });

  const retryMutation = useMutation({
    mutationFn: (deliveryId: number) =>
      api.post(`/webhooks/deliveries/${deliveryId}/retry/`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["webhook-deliveries", endpoint.id] }),
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-medium text-text-primary">Journal de livraison</span>
        <select
          className="select select-sm ml-auto"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Tous les statuts</option>
          <option value="pending">En attente</option>
          <option value="delivered">Livré</option>
          <option value="failed">Échoué</option>
          <option value="abandoned">Abandonné</option>
        </select>
      </div>

      {isLoading && (
        <div className="text-sm text-text-muted text-center py-8">Chargement...</div>
      )}

      {!isLoading && deliveries.length === 0 && (
        <div className="text-sm text-text-muted text-center py-8">
          Aucune livraison pour le moment.
        </div>
      )}

      <div className="space-y-1.5">
        {deliveries.map((d) => (
          <div
            key={d.id}
            className="border border-border rounded-lg overflow-hidden"
          >
            <button
              className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-hover"
              onClick={() => setExpanded(expanded === d.id ? null : d.id)}
            >
              <StatusBadge status={d.status} />
              <span className="text-xs font-mono text-text-muted">{d.event_type}</span>
              <span className="text-xs text-text-muted ml-auto">
                {formatDate(d.created_at)}
              </span>
              {d.response_status && (
                <span className={cn(
                  "text-xs font-mono px-1.5 py-0.5 rounded",
                  d.response_status < 300 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                )}>
                  HTTP {d.response_status}
                </span>
              )}
              <span className="text-xs text-text-muted">×{d.attempts}</span>
              <ChevronRight
                size={14}
                className={cn("text-text-muted transition-transform", expanded === d.id && "rotate-90")}
              />
            </button>

            {expanded === d.id && (
              <div className="border-t border-border px-3 py-3 bg-surface-muted space-y-2">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-text-muted">Clé d'idempotence</span>
                  <span className="font-mono text-text-primary truncate">{d.idempotency_key}</span>
                  <span className="text-text-muted">Tentatives</span>
                  <span className="text-text-primary">{d.attempts}</span>
                  {d.delivered_at && (
                    <>
                      <span className="text-text-muted">Livré le</span>
                      <span className="text-text-primary">{formatDate(d.delivered_at)}</span>
                    </>
                  )}
                  {d.next_attempt_at && d.status !== "delivered" && (
                    <>
                      <span className="text-text-muted">Prochain essai</span>
                      <span className="text-text-primary">{formatDate(d.next_attempt_at)}</span>
                    </>
                  )}
                </div>

                {d.response_body && (
                  <div>
                    <div className="text-xs text-text-muted mb-1">Réponse</div>
                    <pre className="text-xs bg-surface border border-border rounded p-2 overflow-x-auto max-h-32 text-text-primary whitespace-pre-wrap">
                      {d.response_body}
                    </pre>
                  </div>
                )}

                {(d.status === "failed" || d.status === "abandoned") && (
                  <button
                    className="btn btn-sm btn-ghost flex items-center gap-1"
                    onClick={() => retryMutation.mutate(d.id)}
                    disabled={retryMutation.isPending}
                  >
                    {retryMutation.isPending ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RefreshCw size={12} />
                    )}
                    Réessayer
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WebhooksPage() {
  const { canAccess } = usePlan();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<WebhookEndpoint | null>(null);

  const { data: eventTypes = [] } = useQuery<EventType[]>({
    queryKey: ["webhook-event-types"],
    queryFn: () => api.get("/webhooks/endpoints/event_types/").then((r) => r.data),
  });

  const { data: endpoints = [], isLoading } = useQuery<WebhookEndpoint[]>({
    queryKey: ["webhook-endpoints"],
    queryFn: () => api.get("/webhooks/endpoints/").then((r) => r.data.results ?? r.data),
  });

  const selectedEndpoint = endpoints.find((e) => e.id === selectedId) ?? null;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/webhooks/endpoints/${id}/`),
    onSuccess: () => {
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["webhook-endpoints"] });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => api.post(`/webhooks/endpoints/${id}/test/`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["webhook-deliveries", selectedId] }),
  });

  if (!canAccess("pro_retail")) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Webhook size={36} className="text-text-muted opacity-40" />
        <div className="text-text-muted text-sm text-center max-w-xs">
          Les webhooks sont disponibles à partir du plan <strong>Pro Retail</strong>.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Webhooks</h1>
          <p className="text-sm text-text-muted mt-0.5">
            Notifiez vos systèmes externes (comptabilité, e-commerce) lors des événements clés.
          </p>
        </div>
        <button
          className="btn btn-primary flex items-center gap-2"
          onClick={() => { setEditTarget(null); setShowForm(true); }}
        >
          <Plus size={15} />
          Ajouter un endpoint
        </button>
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-6 min-h-[500px]">
        {/* Endpoint list */}
        <div className="space-y-2">
          {isLoading && (
            <div className="text-sm text-text-muted text-center py-10">Chargement...</div>
          )}
          {!isLoading && endpoints.length === 0 && (
            <div className="text-sm text-text-muted text-center py-10 border-2 border-dashed border-border rounded-xl">
              <Webhook size={28} className="mx-auto mb-2 opacity-30" />
              Aucun endpoint configuré
            </div>
          )}
          {endpoints.map((ep) => (
            <div
              key={ep.id}
              className={cn(
                "border rounded-xl p-3 cursor-pointer transition-colors",
                selectedId === ep.id
                  ? "border-accent bg-accent/5"
                  : "border-border bg-surface hover:bg-surface-hover",
              )}
              onClick={() => setSelectedId(ep.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-text-primary truncate">{ep.name}</span>
                    {!ep.is_active && (
                      <span className="text-2xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                        Inactif
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-text-muted font-mono truncate mt-0.5">{ep.url}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <StatusBadge status={ep.last_delivery_status} />
                    <span className="text-xs text-text-muted">{ep.delivery_count} livraisons</span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    className="p-1.5 text-text-muted hover:text-blue-600 rounded"
                    title="Modifier"
                    onClick={(e) => { e.stopPropagation(); setEditTarget(ep); setShowForm(true); }}
                  >
                    <Send size={13} />
                  </button>
                  <button
                    className="p-1.5 text-text-muted hover:text-red-600 rounded"
                    title="Supprimer"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Supprimer l'endpoint "${ep.name}" ?`))
                        deleteMutation.mutate(ep.id);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {ep.events.slice(0, 3).map((ev) => (
                  <span key={ev} className="text-2xs bg-surface-muted border border-border px-1.5 py-0.5 rounded font-mono">
                    {ev}
                  </span>
                ))}
                {ep.events.length > 3 && (
                  <span className="text-2xs text-text-muted">+{ep.events.length - 3}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <div className="border border-border rounded-xl p-5 bg-surface">
          {!selectedEndpoint ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2">
              <Webhook size={32} className="opacity-20" />
              <span className="text-sm">Sélectionnez un endpoint pour voir le journal</span>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-semibold text-text-primary">{selectedEndpoint.name}</div>
                  <div className="text-xs font-mono text-text-muted">{selectedEndpoint.url}</div>
                </div>
                <button
                  className="btn btn-sm btn-ghost flex items-center gap-1.5"
                  onClick={() => testMutation.mutate(selectedEndpoint.id)}
                  disabled={testMutation.isPending}
                >
                  {testMutation.isPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Send size={13} />
                  )}
                  Tester
                </button>
              </div>
              <DeliveryLog endpoint={selectedEndpoint} />
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <EndpointFormModal
          initial={editTarget ?? undefined}
          eventTypes={eventTypes}
          onClose={() => { setShowForm(false); setEditTarget(null); }}
          onSaved={() => qc.invalidateQueries({ queryKey: ["webhook-endpoints"] })}
        />
      )}
    </div>
  );
}
