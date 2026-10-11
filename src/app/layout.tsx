import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";

export const metadata: Metadata = {
  title: "FutCaixa",
  description:
    "Gestão financeira transparente para o seu futebol: lançamentos, cobranças via Pix e sorteio de times.",
  applicationName: "FutCaixa",
  // Manifesto do PWA — torna o app instalável (Requisito 12.1).
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  // Suporte à instalação "Adicionar à Tela de Início" no Safari/iOS.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FutCaixa",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Cor do tema mantida no viewport conforme padrão do Next 15.
  themeColor: "#16a34a",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh antialiased">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
