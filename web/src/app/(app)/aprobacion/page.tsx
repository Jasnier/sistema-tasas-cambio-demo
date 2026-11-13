import Link from "next/link";
import { EnVivo } from "@/components/EnVivo";
import { Aviso, Encabezado, Tarjeta, Vacio } from "@/components/ui";
import { traerTodo } from "@/lib/paginar";
import { exigirPermiso } from "@/lib/sesion";
import { sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { COLUMNAS, fechaHora, parecidos, type FilaMov } from "../movimientos/datos";
import { TablaAprobacion, type FilaAprobacion } from "./TablaAprobacion";

/**
 * STW-29: lo que hoy es "enviar al libro madre". Pestañas por libro (el panel de cada operador),
 * vista previa y aprobación por lote. Solo aparece lo verificado.
 */
const LIMITE = 1000;

export default async function PaginaAprobacion({ searchParams }: PageProps<"/aprobacion">) {
  await exigirPermiso("APROBAR_MOVIMIENTO");
  const sp = await searchParams;
  const libroSel = typeof sp.libro === "string" && /^[0-9a-f-]{36}$/i.test(sp.libro) ? sp.libro : "";
  const supabase = await crearClienteServidor();

  // La lista muestra hasta LIMITE (los más antiguos primero, el orden en que se aprueban) y se filtra por libro en la
  // base; los conteos de las pestañas cuentan TODO lo verificado, por páginas (Supabase corta en max_rows = 1000).
  let q = supabase.from("movimiento").select(COLUMNAS, { count: "exact" }).eq("estado", "VERIFICADO");
  if (libroSel) q = q.eq("libro_id", libroSel);
  const [{ data, count }, { data: pendientes }, librosR] = sinErrores(await Promise.all([
    q.order("fecha_operacion").order("creado_en").order("id").limit(LIMITE),
    traerTodo<{ libro_id: string }>((d, h) => supabase.from("movimiento").select("libro_id").eq("estado", "VERIFICADO").order("id").range(d, h)),
    supabase.from("libro").select("id, prefijo, nombre, tipo").in("tipo", ["operador", "cliente_grande"]).eq("activo", true)
      .order("tipo", { ascending: false }).order("nombre"),
  ]));
  const filas = (data ?? []) as unknown as FilaMov[];
  const porLibro = new Map<string, number>();
  for (const m of pendientes) porLibro.set(m.libro_id, (porLibro.get(m.libro_id) ?? 0) + 1);
  const libros = (librosR.data ?? []) as { id: string; prefijo: string; nombre: string; tipo: string }[];
  // Pestañas: los operadores siempre; los clientes grandes solo si tienen algo pendiente
  const pestanas = libros.filter((l) => l.tipo === "operador" || porLibro.has(l.id));
  const total = count ?? filas.length;
  const dup = await parecidos(supabase, filas.map((m) => m.id));

  const datos: FilaAprobacion[] = filas.map((m) => ({
    id: m.id, codigo: m.codigo, libro: m.libro?.nombre ?? "", fecha: fechaHora(m.fecha_operacion),
    cliente: m.contraparte?.nombre ?? m.contraparte_id, contraparte_id: m.contraparte_id, tipo: m.tipo,
    monto_origen: Number(m.monto_origen), moneda_origen: m.moneda_origen, moneda_destino: m.moneda_destino, modalidad: m.modalidad,
    descuento_tasa: m.descuento_tasa, aprobacion_error: m.aprobacion_error, parecido: dup.get(m.id)?.join(", ") ?? null,
  }));

  const pestana = (href: string, etiqueta: string, n: number, activa: boolean) => (
    <Link key={href} href={href} aria-current={activa ? "page" : undefined}
      className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${activa
        ? "border-primario text-primario" : "border-transparent text-tenue hover:border-borde-fuerte hover:text-texto"}`}>
      {etiqueta}
      <span className={`rounded-full px-1.5 text-xs tabular-nums ${n ? "bg-primario-suave text-primario" : "bg-superficie-2 text-tenue"}`}>{n}</span>
    </Link>
  );

  return (
    <div className="space-y-5">
      <Encabezado
        titulo="Aprobación"
        descripcion="Al aprobar, el sistema toma la tasa vigente según la fecha y hora de la operación y calcula el monto, el saldo del cliente y la utilidad. El operador ve la tasa y el monto solo después de aprobado."
        acciones={<><EnVivo /><Link href="/movimientos?estado=BORRADOR" className="text-sm text-primario hover:underline">Pendientes de verificar →</Link></>}
      />
      <nav aria-label="Libros" className="-mb-px flex flex-wrap border-b border-borde">
        {pestana("/aprobacion", "Todos", pendientes.length, !libroSel)}
        {pestanas.map((l) => pestana(`/aprobacion?libro=${l.id}`, `${l.nombre}`, porLibro.get(l.id) ?? 0, libroSel === l.id))}
      </nav>
      {total > LIMITE && <Aviso>Hay {total.toLocaleString("es-CO")} movimientos verificados: se muestran los {LIMITE} más antiguos. Al aprobarlos aparecen los siguientes.</Aviso>}
      <Tarjeta>
        {datos.length === 0
          ? <Vacio>No hay movimientos verificados por aprobar{libroSel ? " en este libro" : ""}. Primero se verifican en Movimientos.</Vacio>
          : <TablaAprobacion key={libroSel || "todos"} filas={datos} />}
      </Tarjeta>
    </div>
  );
}
