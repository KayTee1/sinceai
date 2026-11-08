import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bonsai",
  description: "Every dashboard must earn its next 90 days.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
