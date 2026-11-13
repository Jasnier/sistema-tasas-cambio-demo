"use server";

import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoLogin = { error?: string };

export async function iniciarSesion(_prev: EstadoLogin, formData: FormData): Promise<EstadoLogin> {
  const correo = String(formData.get("correo") ?? "").trim();
  const clave = String(formData.get("clave") ?? "");
  if (!correo || !clave) return { error: "Escribe tu correo y tu contraseña." };

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({ email: correo, password: clave });
  if (error) return { error: "Correo o contraseña incorrectos." };
  redirect("/");
}

export async function cerrarSesion() {
  const supabase = await crearClienteServidor();
  await supabase.auth.signOut();
  redirect("/login");
}
