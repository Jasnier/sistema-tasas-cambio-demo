import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sistema de Tasas",
  description: "Registro y aprobación de movimientos de tasas de cambio",
};

// Tema antes del primer pintado (sin destello): la elección guardada o, si no hay, la del sistema operativo
const SCRIPT_TEMA = `(function(){try{var t=localStorage.getItem("tema");if(t!=="claro"&&t!=="oscuro"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"oscuro":"claro"}document.documentElement.dataset.tema=t}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
