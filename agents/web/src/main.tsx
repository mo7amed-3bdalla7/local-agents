import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.tsx";
import { AgentsList } from "./pages/AgentsList.tsx";
import { AgentDetail } from "./pages/AgentDetail.tsx";
import { AgentNew } from "./pages/AgentNew.tsx";
import { SessionsList } from "./pages/SessionsList.tsx";
import { SessionDetail } from "./pages/SessionDetail.tsx";
import { ConnectorsList } from "./pages/ConnectorsList.tsx";
import { ConnectorNew } from "./pages/ConnectorNew.tsx";
import { SkillsList } from "./pages/SkillsList.tsx";
import { McpServersList } from "./pages/McpServersList.tsx";
import { McpServerNew } from "./pages/McpServerNew.tsx";
import { PrActivityList } from "./pages/PrActivityList.tsx";
import { ReposList } from "./pages/ReposList.tsx";
import { RepoNew } from "./pages/RepoNew.tsx";
import { UsagePage } from "./pages/UsagePage.tsx";
import { ApprovalsList } from "./pages/ApprovalsList.tsx";
import { NotificationsPage } from "./pages/NotificationsPage.tsx";
import { TokensPage } from "./pages/TokensPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { AuthProvider } from "./auth/AuthContext.tsx";
import { RequireAuth } from "./auth/RequireAuth.tsx";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route index element={<AgentsList />} />
              <Route path="agents" element={<AgentsList />} />
              <Route path="agents/new" element={<AgentNew />} />
              <Route path="agents/:id" element={<AgentDetail />} />
              <Route path="sessions" element={<SessionsList />} />
              <Route path="sessions/:id" element={<SessionDetail />} />
              <Route path="connectors" element={<ConnectorsList />} />
              <Route path="connectors/new" element={<ConnectorNew />} />
              <Route path="skills" element={<SkillsList />} />
              <Route path="mcp-servers" element={<McpServersList />} />
              <Route path="mcp-servers/new" element={<McpServerNew />} />
              <Route path="repos" element={<ReposList />} />
              <Route path="repos/new" element={<RepoNew />} />
              <Route path="pr-activity" element={<PrActivityList />} />
              <Route path="approvals" element={<ApprovalsList />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="tokens" element={<TokensPage />} />
              <Route path="usage" element={<UsagePage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
