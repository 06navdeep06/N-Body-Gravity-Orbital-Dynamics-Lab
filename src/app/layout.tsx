import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { A11yProvider } from "@/components/ui/A11yProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "N-Body Orbital Dynamics Lab",
  description: "A 3D N-body gravitational simulation and orbital dynamics lab.",
  icons: {
    icon: [
      { url: "/textures/logo.png", type: "image/png" },
      { url: "/logo.png", type: "image/png" },
    ],
    shortcut: "/textures/logo.png",
    apple: "/textures/logo.png",
  },
  openGraph: {
    title: "N-Body Orbital Dynamics Lab",
    description: "A 3D N-body gravitational simulation and orbital dynamics lab.",
    images: [{ url: "/textures/logo.png", width: 512, height: 512, alt: "N-Body Dynamics Logo" }],
  },
  twitter: {
    card: "summary",
    title: "N-Body Orbital Dynamics Lab",
    description: "A 3D N-body gravitational simulation and orbital dynamics lab.",
    images: ["/textures/logo.png"],
  },
};

/**
 * `viewportFit: "cover"` lets the scene run under a notch/home indicator; the
 * chrome that must stay clear of them uses the `safe-area-inset-*` env vars.
 * Zoom is deliberately left enabled — pinch-zoom is a genuine accessibility
 * affordance, and the canvas handles its own gestures.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <A11yProvider />
        {children}
      </body>
    </html>
  );
}
