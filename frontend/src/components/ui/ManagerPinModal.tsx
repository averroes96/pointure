import React, { useState, useEffect, useRef } from "react";
import { ShieldCheck, ShieldAlert, Lock, Delete, X, Check } from "lucide-react";
import api from "@/lib/api";
import { getApiError } from "@/lib/api";

interface ManagerInfo {
  manager_id: string;
  manager_name: string;
  role: string;
}

interface ManagerPinModalProps {
  isOpen: boolean;
  title?: string;
  reason: string;
  actionDescription?: string;
  onSuccess: (pin: string, managerInfo: ManagerInfo) => void;
  onCancel: () => void;
}

export default function ManagerPinModal({
  isOpen,
  title = "Autorisation Responsable requise",
  reason,
  actionDescription,
  onSuccess,
  onCancel,
}: ManagerPinModalProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened and reset state
  useEffect(() => {
    if (isOpen) {
      setPin("");
      setError(null);
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Physical keyboard listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key >= "0" && e.key <= "9") {
        if (pin.length < 6) {
          handleDigitClick(e.key);
        }
      } else if (e.key === "Backspace") {
        handleBackspace();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (pin.length >= 4) {
          submitPin(pin);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, pin]);

  const handleDigitClick = (digit: string) => {
    if (isLoading) return;
    setError(null);
    if (pin.length < 6) {
      const nextPin = pin + digit;
      setPin(nextPin);
      // Auto submit when 4 digits reached if typical, or allow 4-6
      if (nextPin.length === 4) {
        // give tiny visual feedback then verify
        setTimeout(() => submitPin(nextPin), 150);
      }
    }
  };

  const handleBackspace = () => {
    if (isLoading) return;
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    if (isLoading) return;
    setError(null);
    setPin("");
  };

  const submitPin = async (pinToSubmit: string) => {
    if (!pinToSubmit || pinToSubmit.length < 4 || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await api.post<ManagerInfo & { valid: boolean }>("/core/users/verify-manager-pin/", {
        pin: pinToSubmit,
      });

      if (res.data?.valid) {
        onSuccess(pinToSubmit, {
          manager_id: res.data.manager_id,
          manager_name: res.data.manager_name,
          role: res.data.role,
        });
      } else {
        throw new Error("Code PIN invalide.");
      }
    } catch (err: any) {
      setError(getApiError(err) || "Code PIN incorrect. Veuillez réessayer.");
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
      setPin("");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className={`bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden flex flex-col transition-transform ${
          isShaking ? "animate-bounce" : ""
        }`}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/20 backdrop-blur rounded-xl text-white">
              <Lock size={20} className="stroke-[2.5]" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-tight leading-snug">{title}</h3>
              <p className="text-2xs text-amber-100 font-medium">Contrôle de sécurité POS</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="p-1.5 hover:bg-white/20 text-white/80 hover:text-white rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Reason Alert Banner */}
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-start gap-2.5 p-3 bg-amber-50 rounded-xl border border-amber-200/80 text-amber-900">
            <ShieldAlert size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <span className="font-semibold">{reason}</span>
              {actionDescription && (
                <p className="text-2xs text-amber-700 mt-0.5">{actionDescription}</p>
              )}
            </div>
          </div>
        </div>

        {/* PIN Display Dots */}
        <div className="px-5 py-3 text-center">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-2">
            Entrez le code PIN du Responsable (4 à 6 chiffres)
          </label>

          {/* Hidden input for software keyboards / autofocus */}
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "");
              if (val.length <= 6) {
                setPin(val);
                if (val.length === 4) submitPin(val);
              }
            }}
            className="sr-only"
          />

          {/* Dots Indicator */}
          <div className="flex items-center justify-center gap-3 py-2">
            {[0, 1, 2, 3].map((index) => {
              const filled = pin.length > index;
              return (
                <div
                  key={index}
                  className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                    filled
                      ? "bg-amber-600 border-amber-600 scale-110 shadow-sm"
                      : "bg-slate-100 border-slate-300"
                  }`}
                />
              );
            })}
            {pin.length > 4 && (
              <span className="text-xs font-mono font-bold text-amber-700 ml-1">
                +{pin.length - 4}
              </span>
            )}
          </div>

          {error && (
            <p className="text-xs font-medium text-rose-600 mt-2 animate-in fade-in">
              {error}
            </p>
          )}
        </div>

        {/* Virtual Numpad */}
        <div className="px-6 pb-5 pt-1">
          <div className="grid grid-cols-3 gap-2.5">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => handleDigitClick(String(num))}
                disabled={isLoading}
                className="h-12 text-lg font-bold text-slate-800 bg-slate-50 hover:bg-slate-100 active:bg-amber-100 active:text-amber-700 border border-slate-200 rounded-xl transition-all shadow-2xs hover:shadow active:scale-95 disabled:opacity-50"
              >
                {num}
              </button>
            ))}

            {/* Clear button */}
            <button
              type="button"
              onClick={handleClear}
              disabled={isLoading || pin.length === 0}
              className="h-12 text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 border border-slate-200 rounded-xl transition-all active:scale-95 disabled:opacity-40"
            >
              Effacer
            </button>

            {/* Zero */}
            <button
              type="button"
              onClick={() => handleDigitClick("0")}
              disabled={isLoading}
              className="h-12 text-lg font-bold text-slate-800 bg-slate-50 hover:bg-slate-100 active:bg-amber-100 active:text-amber-700 border border-slate-200 rounded-xl transition-all shadow-2xs hover:shadow active:scale-95 disabled:opacity-50"
            >
              0
            </button>

            {/* Backspace */}
            <button
              type="button"
              onClick={handleBackspace}
              disabled={isLoading || pin.length === 0}
              className="h-12 flex items-center justify-center text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 border border-slate-200 rounded-xl transition-all active:scale-95 disabled:opacity-40"
            >
              <Delete size={20} />
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="flex-1 py-2.5 px-3 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Annuler (Échap)
            </button>
            <button
              type="button"
              onClick={() => submitPin(pin)}
              disabled={isLoading || pin.length < 4}
              className="flex-1 py-2.5 px-3 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 active:bg-amber-800 rounded-xl transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <Check size={16} />
                  Valider
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
