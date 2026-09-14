import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Raise a PR",
  description: "Open a GitHub pull request through the REST API",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
