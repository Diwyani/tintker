import type { Metadata } from "next";
import { Geist, Homemade_Apple } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const hand = Homemade_Apple({ variable: "--font-hand", weight: "400", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Tintker",
  description: "Find a colour palette in a photo or film still.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${hand.variable}`}>
      <body style={{ margin: 0, background: "#202122" }}>{children}</body>
    </html>
  );
}
