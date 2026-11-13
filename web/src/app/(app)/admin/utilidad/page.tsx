import Link from "next/link";
import { boton, botonSuave, campo, etiqueta } from "@/components/estilos";
import { Encabezado, Tarjeta, Vacio } from "@/components/ui";
import { exigirPermiso } from "@/lib/sesion";
import { sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { fechaHora } from "../../movimientos/datos";
import { TablaUtilidad, type FilaUtilidad } from "./TablaUtilidad";

type Fila = {
  id: string; codigo: string; fecha_operacion: string; contraparte_id: string; moneda_origen: string; moneda_destino: string; modalidad: string;
  monto_origen: number; tasa_aplicada: number; periodo_id: string | null; contraparte: { nombre: string } | null;
  movimiento_utilidad: { tasa_adquisicion: number; utilidad: number; marca_utilidad: string | null } | null;
};

/**
 * STW-34: ajustar utilidad (reemplaza "Quitar utilidad" y "Quitar utilidades múltiples" del Motor). Se filtra,
 * se marca lo que se quiere ajustar y el ajuste se aplica SOLO a lo marcado (P-35), con vista previa.
 */
export default async function PaginaUtilidad({ searchParams }: PageProps<"/admin/utilidad">) {
  await exigirPermiso("AJUSTAR_UTILIDAD");
  const sp = await searchParams;
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const f = { q: g("q").replace(/[,()%*\\]/g, " "), ct: g("ct"), mo: g("mo"), md: g("md"), modalidad: g("modalidad"), desde: g("desde"), hasta: g("hasta") };
  const supabase = await crearClienteServidor();

  let q = supabase.from("movimiento")
    .select("id, codigo, fecha_operacion, contraparte_id, moneda_origen, moneda_destino, modalidad, monto_origen, tasa_aplicada, periodo_id, contraparte(nombre), movimiento_utilidad(tasa_adquisicion, utilidad, marca_utilidad)")
    .eq("estado", "APROBADO").order("fecha_operacion", { ascending: false }).limit(300);
  if (f.q) q = q.or(`codigo.ilike.*${f.q}*,id_transaccion.ilike.*${f.q}*`);
  if (/^CT-\d+$/.test(f.ct)) q = q.eq("contraparte_id", f.ct);
  if (f.mo) q = q.eq("moneda_origen", f.mo);
  if (f.md) q = q.eq("moneda_destino", f.md);
  if (f.modalidad) q = q.eq("modalidad", f.modalidad);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.desde)) q = q.gte("fecha_operacion", `${f.desde}T00:00:00-05:00`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.hasta)) q = q.lte("fecha_operacion", `${f.hasta}T23:59:59.999-05:00`);
  const [{ data }, ctR, monR] = sinErrores(await Promise.all([
    q,
    supabase.from("contraparte").select("id, nombre").eq("activo", true).order("nombre"),
    supabase.from("moneda").select("nombre").eq("activo", true).order("orden"),
  ]));
  const filas: FilaUtilidad[] = ((data ?? []) as unknown as Fila[]).filter((m) => m.movimiento_utilidad).map((m) => ({
    id: m.id, codigo: m.codigo, fecha: fechaHora(m.fecha_operacion), cliente: m.contraparte?.nombre ?? m.contraparte_id,
    par: `${m.moneda_origen}→${m.moneda_destino}`, modalidad: m.modalidad, monto: Number(m.monto_origen), tasa: Number(m.tasa_aplicada),
    tasa_adq: Number(m.movimiento_utilidad!.tasa_adquisicion), utilidad: Number(m.movimiento_utilidad!.utilidad),
    marca: m.movimiento_utilidad!.marca_utilidad, periodo: m.periodo_id,
  }));
  const monedas = (monR.data ?? []).map((m) => m.nombre as string);

  return (
    <div className="space-y-5">
      <Encabezado titulo="Ajustar utilidad"
        descripcion="Para quitar toda la utilidad de un movimiento (la casa compra a la misma tasa que el cliente) o restarle puntos. Solo se aplica a lo que marque; lo que ya tenía un ajuste manual no se toca. Todo queda con su motivo y registrado." />
      <form method="get" className="grid gap-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <label className={etiqueta}>Código o id de transacción<input name="q" defaultValue={f.q} className={campo} /></label>
        <label className={etiqueta}>Cliente o aliado
          <select name="ct" defaultValue={f.ct} className={campo}><option value="">Todos</option>
            {(ctR.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre} · {c.id}</option>)}</select>
        </label>
        <label className={etiqueta}>Desde<input type="date" name="desde" defaultValue={f.desde} className={campo} /></label>
        <label className={etiqueta}>Hasta<input type="date" name="hasta" defaultValue={f.hasta} className={campo} /></label>
        <label className={etiqueta}>Moneda origen<select name="mo" defaultValue={f.mo} className={campo}><option value="">Todas</option>{monedas.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className={etiqueta}>Moneda destino<select name="md" defaultValue={f.md} className={campo}><option value="">Todas</option>{monedas.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className={etiqueta}>Modalidad<select name="modalidad" defaultValue={f.modalidad} className={campo}><option value="">Todas</option><option>TRANSFERENCIA</option><option>EFECTIVO</option></select></label>
        <div className="flex items-end gap-2"><button className={boton}>Buscar</button><Link href="/admin/utilidad" className={botonSuave}>Limpiar</Link></div>
      </form>
      <Tarjeta titulo={`${filas.length} movimiento(s) aprobado(s)${filas.length === 300 ? " (máximo 300: afine los filtros)" : ""}`}>
        {filas.length === 0 ? <Vacio>No hay movimientos aprobados con esos filtros.</Vacio> : <TablaUtilidad filas={filas} />}
      </Tarjeta>
    </div>
  );
}
