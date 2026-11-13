import Link from "next/link";
import { Aviso, Encabezado, Tarjeta } from "@/components/ui";
import { ahoraMs } from "@/lib/fechas";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { catalogos, partesBogota } from "../datos";
import { FormularioMovimiento } from "../FormularioMovimiento";

/** STW-22: registrar un movimiento (reemplaza el formulario de REGISTRAR en los libros de Sheets). */
export default async function PaginaNuevoMovimiento({ searchParams }: PageProps<"/movimientos/nuevo">) {
  const sesion = await exigirPermiso("REGISTRAR_MOVIMIENTO");
  const sp = await searchParams;
  const supabase = await crearClienteServidor();
  const cat = await catalogos(supabase);

  // Solo los libros donde puede registrar: los suyos; la administración, todos
  let libros = cat.libros;
  if (!sesion.permisos.has("APROBAR_MOVIMIENTO")) {
    const { data } = await supabase.from("libro_usuario").select("libro_id").eq("usuario_id", sesion.id);
    const mios = new Set((data ?? []).map((r) => r.libro_id as string));
    libros = libros.filter((l) => mios.has(l.id));
  }
  const pedido = typeof sp.libro === "string" ? sp.libro : "";
  const hoy = partesBogota(new Date((await ahoraMs())).toISOString()).fecha;

  return (
    <div className="space-y-6">
      <Encabezado
        migas={[{ href: "/movimientos", etiqueta: "Movimientos" }]}
        titulo="Registrar movimiento"
        descripcion="El código del movimiento lo pone el sistema al guardar, sin repetirse aunque dos personas registren a la vez. El ID de transacción no se puede repetir en ningún libro."
        acciones={<Link href="/movimientos" className="text-sm text-primario hover:underline">Ver bandeja →</Link>}
      />
      {libros.length === 0 ? (
        <Aviso>Su usuario no está asignado a ningún libro. Pida a la administración que lo asigne.</Aviso>
      ) : libros.every((l) => l.tipo === "cliente_grande" && !l.contraparte_id) ? (
        <Aviso>Su libro todavía no tiene código de cliente (CT) asignado. La administración lo asigna en Configuración → Clientes grandes.</Aviso>
      ) : cat.monedas.length === 0 || cat.contrapartes.length === 0 ? (
        <Aviso>Faltan monedas o clientes en los catálogos: primero hay que cargarlos (Catálogos).</Aviso>
      ) : (
        <Tarjeta>
          <FormularioMovimiento
            libros={libros}
            monedas={cat.monedas}
            recibidos={cat.recibidos}
            empresas={cat.empresas}
            contrapartes={cat.contrapartes}
            puedeDescuento={sesion.permisos.has("APLICAR_DESCUENTO")}
            hoy={hoy}
            valores={{
              libro_id: libros.some((l) => l.id === pedido) ? pedido : libros[0].id,
              id_transaccion: "", tipo: "ENTRADA", fecha: hoy, hora: "", modalidad: "TRANSFERENCIA", contraparte_id: "",
              moneda_origen: "", moneda_destino: "", monto_origen: "", recibido_en_id: "", empresa_id: "", tercero: "",
              observaciones: "", descuento_tasa: false,
            }}
          />
        </Tarjeta>
      )}
    </div>
  );
}
