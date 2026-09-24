import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Potlock",
  description: "Lock in. Play. Winner takes the pot.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;700&family=Inter:wght@400;600&display=swap"
        />
      </head>
      <body className="min-h-screen font-[Inter,ui-sans-serif,system-ui]">{children}</body>
    </html>
  );
}
