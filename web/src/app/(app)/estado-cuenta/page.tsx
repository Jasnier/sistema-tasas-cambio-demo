import Link from "next/link";
import { boton, botonSuave, campo, etiqueta } from "@/components/estilos";
import { Aviso, Cifra, Encabezado, Insignia, Tarjeta, Vacio, dinero } from "@/components/ui";
import { avisoTope, traerTodo } from "@/lib/paginar";
import { exigirPermiso } from "@/lib/sesion";
import { sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { fechaHora, tasa } from "../movimientos/datos";
import { estadoDeCuenta, leerFiltroCuenta } from "./datos";
import { BotonImprimir } from "./BotonImprimir";
import { Paginacion } from "@/components/Paginacion";
import { POR_PAGINA, leerPagina } from "@/lib/paginacion";

/** STW-39: estado de cuenta de un cliente en una moneda y modalidad (reemplaza DETALLE_CLIENTE del Motor). */
export default async function PaginaEstadoCuenta({ searchParams }: PageProps<"/estado-cuenta">) {
  await exigirPermiso("VER_REPORTES");
  const sp = await searchParams;
  const f = leerFiltroCuenta(sp);
  const pagina = leerPagina(sp);
  // En pantalla se ve una página; al imprimir sale todo (las demás filas van ocultas, solo para impresión)
  const enPagina = (i: number) => i >= (pagina - 1) * POR_PAGINA && i < pagina * POR_PAGINA;
  const supabase = await crearClienteServidor();
  // Solo los clientes cuyo saldo puede ver (la base filtra saldo_bucket: el operador, los suyos; la administración, todos)
  const [{ data: visibles }, monedasR] = sinErrores(await Promise.all([
    traerTodo<{ contraparte_id: string; nombre: string }>((d, h) => supabase.from("saldo_cliente").select("contraparte_id, nombre")
      .order("nombre").order("contraparte_id").order("moneda").order("modalidad").range(d, h)),
    supabase.from("moneda").select("nombre").eq("activo", true).order("orden"),
  ]));
  const contrapartes = [...new Map(visibles.map((c) => [c.contraparte_id, { id: c.contraparte_id, nombre: c.nombre }])).values()];
  const monedas = (monedasR.data ?? []).map((m) => m.nombre as string);
  const moneda = f.moneda || (monedas.includes("COP") ? "COP" : monedas[0] ?? "");
  const cliente = contrapartes.find((c) => c.id === f.ct);
  // Un cliente que no es suyo (p. ej. un enlace copiado): la base lo rechaza y se avisa en vez de fallar la página
  const cuenta = f.ct && moneda && cliente ? await estadoDeCuenta(supabase, { ...f, moneda }) : null;
  const ajeno = Boolean(f.ct && !cliente);
  const qs = new URLSearchParams({ ct: f.ct, moneda, modalidad: f.modalidad, ...(f.desde && { desde: f.desde }), ...(f.hasta && { hasta: f.hasta }) }).toString();

  return (
    <div className="space-y-5">
      <Encabezado
        titulo="Estado de cuenta"
        descripcion="Movimientos aprobados de un cliente en una moneda y modalidad, en el orden en que se aprobaron, con el saldo después de cada uno. Los que registró otro operador se ven en tono claro."
        acciones={cuenta && cuenta.lineas.length > 0 && (
          <div className="flex gap-2 print:hidden">
            <Link href={`/estado-cuenta/exportar?${qs}`} prefetch={false} className={botonSuave}>Exportar a Excel (CSV)</Link>
            <BotonImprimir />
          </div>
        )}
      />

      <form method="get" className="grid gap-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-6 print:hidden">
        <label className={`${etiqueta} sm:col-span-2`}>Cliente o aliado
          <select name="ct" defaultValue={f.ct} required className={campo}>
            <option value="" disabled>Elija…</option>
            {contrapartes.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {c.id}</option>)}
          </select>
        </label>
        <label className={etiqueta}>Moneda
          <select name="moneda" defaultValue={moneda} className={campo}>{monedas.map((m) => <option key={m}>{m}</option>)}</select>
        </label>
        <label className={etiqueta}>Modalidad
          <select name="modalidad" defaultValue={f.modalidad} className={campo}><option>TRANSFERENCIA</option><option>EFECTIVO</option></select>
        </label>
        <label className={etiqueta}>Desde<input type="date" name="desde" defaultValue={f.desde} className={campo} /></label>
        <label className={etiqueta}>Hasta<input type="date" name="hasta" defaultValue={f.hasta} className={campo} /></label>
        <div className="sm:col-span-2 lg:col-span-6"><button className={boton}>Ver estado de cuenta</button></div>
      </form>

      {!cuenta ? (ajeno
        ? <Aviso tono="peligro">{f.ct} no es uno de sus clientes: solo puede ver el estado de cuenta de los clientes que tienen movimientos en su libro.</Aviso>
        : <Vacio>Elija un cliente para ver su estado de cuenta.</Vacio>) : (
        <>
          {cuenta.truncado && <Aviso tono="peligro">{avisoTope()} El saldo final y los totales no están completos.</Aviso>}
          <div className="hidden print:block">
            <h2 className="text-lg font-semibold">{cliente?.nombre} · {f.ct}</h2>
            <p className="text-sm">{moneda} · {f.modalidad.toLowerCase()} · {f.desde || "desde el inicio"} a {f.hasta || "hoy"}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Cifra etiqueta="Saldo inicial" valor={dinero(cuenta.saldoInicial)} />
            <Cifra etiqueta="Entradas" valor={dinero(cuenta.entradas)} tono="exito" />
            <Cifra etiqueta="Salidas" valor={dinero(cuenta.salidas)} tono="peligro" />
            <Cifra etiqueta="Saldo final" valor={dinero(cuenta.saldoFinal)} tono={cuenta.saldoFinal < 0 ? "peligro" : "primario"} detalle={`${cuenta.lineas.length} movimiento(s)`} />
          </div>
          <Tarjeta titulo={<>{cliente?.nombre ?? f.ct} <span className="font-normal text-tenue">· {f.ct} · {moneda} · {f.modalidad.toLowerCase()}</span></>}>
            {cuenta.ajenos > 0 && (
              <p className="mb-3 text-xs text-tenue">
                Las filas en tono claro ({cuenta.ajenos}) se registraron en otro libro: cuentan en el saldo del cliente, pero no son de su libro y no se pueden abrir ni editar.
              </p>
            )}
            {cuenta.lineas.length === 0 ? <Vacio>No hay movimientos aprobados en ese rango.</Vacio> : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-borde text-left">
                    <th className="px-4 py-2">Fecha</th><th className="px-2 py-2">Código</th><th className="px-2 py-2">Mov.</th>
                    <th className="px-2 py-2 text-right">Monto origen</th><th className="px-2 py-2 text-right">Tasa</th>
                    <th className="px-2 py-2 text-right">Entrada</th><th className="px-2 py-2 text-right">Salida</th><th className="px-2 py-2 text-right">Saldo</th>
                  </tr></thead>
                  <tbody>
                    <tr className={`border-b border-borde/70 bg-superficie-2/60 text-tenue ${pagina > 1 ? "hidden print:table-row" : ""}`}>
                      <td className="px-4 py-1.5" colSpan={7}>Saldo inicial</td><td className="px-2 py-1.5 text-right tabular-nums">{dinero(cuenta.saldoInicial)}</td>
                    </tr>
                    {cuenta.lineas.map((l, i) => (
                      <tr key={l.id} className={`border-b border-borde/70 align-top ${l.es_propio ? "" : "bg-superficie-2/40 text-tenue"} ${enPagina(i) ? "" : "hidden print:table-row"}`}
                        title={l.es_propio ? undefined : `Registrado en ${l.libro?.nombre}: cuenta en el saldo, pero no es de su libro y no se puede editar`}>
                        <td className="px-4 py-1.5 whitespace-nowrap tabular-nums">{fechaHora(l.fecha_operacion)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {l.es_propio
                            ? <Link href={`/movimientos/${l.id}`} className="font-mono text-xs font-semibold text-primario hover:underline print:text-texto">{l.codigo}</Link>
                            : <span className="font-mono text-xs font-semibold">{l.codigo}</span>}
                          <span className="block text-xs text-tenue">{l.libro?.nombre}{l.es_propio ? (l.tercero ? ` · ${l.tercero}` : "") : " · otro libro"}</span>
                        </td>
                        <td className="px-2 py-1.5"><Insignia tono={l.tipo === "ENTRADA" ? "exito" : "peligro"}>{l.tipo === "ENTRADA" ? "Entrada" : "Salida"}</Insignia></td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">{dinero(l.monto_origen)} <span className="text-xs text-tenue">{l.moneda_origen}</span></td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{tasa(l.tasa_aplicada)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-exito">{Number(l.entrada) ? dinero(l.entrada) : ""}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-peligro">{Number(l.salida) ? dinero(l.salida) : ""}</td>
                        <td className={`px-2 py-1.5 text-right font-medium tabular-nums ${Number(l.saldo_post) < 0 ? "text-peligro" : ""}`}>{dinero(l.saldo_post)}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="px-4 py-2" colSpan={5}>Totales</td>
                      <td className="px-2 py-2 text-right tabular-nums text-exito">{dinero(cuenta.entradas)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-peligro">{dinero(cuenta.salidas)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{dinero(cuenta.saldoFinal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <Paginacion ruta="/estado-cuenta" sp={sp} total={cuenta.lineas.length} pagina={pagina} className="mt-3 print:hidden" />
          </Tarjeta>
        </>
      )}
    </div>
  );
}
