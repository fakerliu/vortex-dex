import type { Metadata } from "next";
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";
import { config } from "@/config/wagmi";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "VORTEX DEX",
  description: "Find the best route across decentralized exchanges.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookie = (await headers()).get("cookie");
  const initialState = cookieToInitialState(config, cookie);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col font-sans">
        <Providers initialState={initialState}>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
