import type { Metadata } from "next";
import { Geist } from "next/font/google";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Tintker",
  description: "Find a colour palette in a photo or film still.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geistSans.variable}>
      <body style={{ margin: 0, background: "#202122" }}>{children}</body>
    </html>
  );
}
