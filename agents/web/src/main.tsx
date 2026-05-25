import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.tsx";
import { AgentsList } from "./pages/AgentsList.tsx";
import { AgentDetail } from "./pages/AgentDetail.tsx";
import { SessionsList } from "./pages/SessionsList.tsx";
import { SessionDetail } from "./pages/SessionDetail.tsx";
import { ConnectorsList } from "./pages/ConnectorsList.tsx";
import { SkillsList } from "./pages/SkillsList.tsx";
import { McpServersList } from "./pages/McpServersList.tsx";
import { PrActivityList } from "./pages/PrActivityList.tsx";
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
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<AgentsList />} />
            <Route path="agents" element={<AgentsList />} />
            <Route path="agents/:id" element={<AgentDetail />} />
            <Route path="sessions" element={<SessionsList />} />
            <Route path="sessions/:id" element={<SessionDetail />} />
            <Route path="connectors" element={<ConnectorsList />} />
            <Route path="skills" element={<SkillsList />} />
            <Route path="mcp-servers" element={<McpServersList />} />
            <Route path="pr-activity" element={<PrActivityList />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
