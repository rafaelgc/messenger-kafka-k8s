import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AuthProvider } from "@/components/providers/auth-provider";
import { MessageDeliveryProvider } from "@/components/providers/message-delivery-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Messaging",
  description: "Distributed messaging system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={inter.className}>
        <AuthProvider>
          <MessageDeliveryProvider>{children}</MessageDeliveryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
