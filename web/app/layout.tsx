import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
	title: "Polish Academic MCP — panel admin",
	description: "Panel administracyjny tokenów JWT i limitów wywołań",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
		return (
		<html lang="pl">
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased`}
			>
				{children}
			</body>
		</html>
	);
}
