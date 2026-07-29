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

const SITE_URL = "https://niteowlhq.com";
const OG_TITLE = "Remy — Never miss another customer enquiry";
const OG_DESCRIPTION =
  "Your AI receptionist that answers customer questions instantly, captures every enquiry, and books appointments 24/7 — then hands unusual requests to your team.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Remy — AI Receptionist for Small Businesses | NiteOwl HQ",
  description: OG_DESCRIPTION,
  keywords: [
    "AI receptionist",
    "AI chat for business",
    "lead capture",
    "appointment booking",
    "small business chatbot",
    "customer enquiries",
    "Remy",
    "NiteOwl",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "NiteOwl HQ",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
  },
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
