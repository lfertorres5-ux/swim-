import type { Metadata, Viewport } from "next";
import { Fraunces, Figtree } from "next/font/google";
import { brand } from "@/config/brand";
import "./globals.css";

const heading = Fraunces({ variable: "--font-heading", subsets: ["latin"], axes: ["SOFT", "opsz"] });
const body = Figtree({ variable: "--font-body", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: `${brand.name} — Private In-Home Swim Lessons in San Diego`, template: `%s · ${brand.name}` },
  description: brand.tagline,
};

export const viewport: Viewport = { themeColor: "#faf6ef" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable} h-full`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
