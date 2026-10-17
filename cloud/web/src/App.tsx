import { AppShell } from "@/components/layout/AppShell";
import { AccountPage } from "@/pages/AccountPage";
import { AdminPage } from "@/pages/AdminPage";
import { ChangelogPage } from "@/pages/ChangelogPage";
import { ConnectorsPage } from "@/pages/ConnectorsPage";
import { HomePage } from "@/pages/HomePage";
import { LoginPage } from "@/pages/LoginPage";
import { PrivacyPage } from "@/pages/PrivacyPage";
import { ProjectPage } from "@/pages/ProjectPage";
import { TermsPage } from "@/pages/TermsPage";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Suspense, lazy } from "react";

const DocsPage = lazy(() =>
  import("@/pages/DocsPage").then((m) => ({ default: m.DocsPage })),
);

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="connectors" element={<ConnectorsPage />} />
          <Route
            path="connectors/docs"
            element={
              <Suspense fallback={<p className="text-sm text-fg-secondary">Ładowanie dokumentacji…</p>}>
                <DocsPage />
              </Suspense>
            }
          />
          <Route
            path="docs"
            element={
              <Suspense fallback={<p className="text-sm text-fg-secondary">Ładowanie dokumentacji…</p>}>
                <DocsPage />
              </Suspense>
            }
          />
          <Route
            path="docs/*"
            element={
              <Suspense fallback={<p className="text-sm text-fg-secondary">Ładowanie dokumentacji…</p>}>
                <DocsPage />
              </Suspense>
            }
          />
          <Route path="projekt" element={<ProjectPage />} />
          <Route path="changelog" element={<ChangelogPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          <Route path="terms" element={<TermsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
