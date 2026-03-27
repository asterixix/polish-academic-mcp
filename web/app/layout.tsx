import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppChrome } from "../components/app-chrome";
import { SITE_PROJECT_NAME } from "../lib/site-branding";
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
	title: `${SITE_PROJECT_NAME} — panel admin`,
	description:
		"Panel administracyjny tokenów JWT i limitów wywołań (Polish Academic MCP)",
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
				<AppChrome>{children}</AppChrome>
			</body>
		</html>
	);
}
