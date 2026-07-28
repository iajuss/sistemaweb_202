import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeInitializer } from "./theme-initializer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const themeBootstrap = `(()=>{try{const root=document.documentElement;const auth=['/login','/signup'].includes(location.pathname);const theme=localStorage.getItem('controle-carteira-theme');const vision=localStorage.getItem('controle-carteira-vision');const font=localStorage.getItem('controle-carteira-font-size');root.dataset.theme=auth?'light':theme==='dark'?'dark':'light';root.dataset.vision=vision==='colorblind'?'colorblind':'default';root.dataset.fontSize=['small','normal','large'].includes(font||'')?font:'normal'}catch(_){}})();`;

// Sem isso, celulares renderizam a página numa largura virtual de desktop
// (~980px) e encolhem tudo pra caber, o que também tira o efeito dos
// `@media(max-width:...)` do CSS (eles nunca disparam) e deixa a página
// dar pinch-zoom livremente em vez de já se ajustar à tela do aparelho.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";

  return {
    metadataBase: new URL(`${protocol}://${host}`),
    title: "Controle de Carteira",
    description: "Gestão de carteiras contábeis, cadastros e obrigações.",
    openGraph: { title: "Controle de Carteira", description: "Gestão de carteiras contábeis, cadastros e obrigações.", images: [{ url: "/og.png", width: 1728, height: 972 }] },
    twitter: { card: "summary_large_image", images: ["/og.png"] },
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeInitializer />
        {children}
      </body>
    </html>
  );
}
