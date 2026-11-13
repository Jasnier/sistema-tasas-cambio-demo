import { dinero } from "@/components/ui";
import type { ResultadoCorreccion } from "./correcciones";

const tasa = (n?: number | null) => (n == null ? "" : Number(n).toLocaleString("es-CO", { maximumFractionDigits: 6 }));

/** Antes → después de una corrección (vista previa o aplicada), con los saldos recalculados. */
export function ResumenCorreccion({ estado }: { estado: ResultadoCorreccion }) {
  if (estado.error) return <p role="alert" className="rounded-md bg-peligro-suave px-3 py-2 text-sm text-peligro">{estado.error}</p>;
  if (!estado.resultados) return null;
  return (
    <div role="status" className="space-y-2 rounded-lg border border-info/30 bg-info-suave p-3 text-sm">
      <p className="font-medium text-info">{estado.simulado ? "Vista previa (no se guardó nada)" : "Corrección aplicada"}: {estado.corregidos} movimiento(s).</p>
      <ul className="space-y-1">
        {estado.resultados.slice(0, 20).map((r) => (
          <li key={r.id} className="tabular-nums">
            <span className="font-mono text-xs font-semibold">{r.codigo}</span>{" "}
            tasa {tasa(r.antes.tasa)} → <strong>{tasa(r.despues.tasa)}</strong> · {dinero(r.antes.monto_destino)} {r.antes.moneda_destino} →{" "}
            <strong>{dinero(r.despues.monto_destino)} {r.despues.moneda_destino}</strong>
            {r.antes.modalidad !== r.despues.modalidad && <> · {r.antes.modalidad.toLowerCase()} → {r.despues.modalidad.toLowerCase()}</>}
            {r.antes.contraparte_id !== r.despues.contraparte_id && <> · {r.antes.contraparte_id} → {r.despues.contraparte_id}</>}
            {" "}· saldo después {dinero(r.saldo_post)}
            {r.antes.utilidad != null && <span className="text-tenue"> · utilidad {dinero(r.antes.utilidad)} → {dinero(r.despues.utilidad)}</span>}
          </li>
        ))}
      </ul>
      {estado.saldos && estado.saldos.length > 0 && (
        <p className="text-xs text-tenue">Saldos recalculados: {estado.saldos.map((s) => `${s.contraparte_id} ${s.moneda} ${s.modalidad.toLowerCase()} = ${dinero(s.saldo)}`).join(" · ")}</p>
      )}
      {estado.negativos && estado.negativos.length > 0 && (
        <p className="font-medium text-peligro">
          ⚠ Queda negativo: {estado.negativos.map((n) => `${n.contraparte_id} ${n.moneda} ${n.modalidad.toLowerCase()} desde ${n.primer_negativo} (${dinero(n.saldo_negativo)})`).join("; ")}.
          Para aplicarlo hay que marcar la confirmación.
        </p>
      )}
    </div>
  );
}
