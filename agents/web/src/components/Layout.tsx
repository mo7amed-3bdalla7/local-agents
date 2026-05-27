import { useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Bell,
  Boxes,
  Bot,
  FileStack,
  FolderGit2,
  GitPullRequest,
  KeyRound,
  LogOut,
  PlugZap,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Bot;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/agents", label: "Agents", icon: Bot, end: false },
  { to: "/templates", label: "Templates", icon: FileStack, end: false },
  { to: "/sessions", label: "Sessions", icon: Activity, end: false },
  { to: "/connectors", label: "Connectors", icon: PlugZap, end: false },
  { to: "/skills", label: "Skills", icon: Sparkles, end: false },
  { to: "/mcp-servers", label: "MCP servers", icon: Wrench, end: false },
  { to: "/repos", label: "Repos", icon: FolderGit2, end: false },
  { to: "/pr-activity", label: "PR activity", icon: GitPullRequest, end: false },
  { to: "/approvals", label: "Approvals", icon: ShieldCheck, end: false },
  { to: "/notifications", label: "Notifications", icon: Bell, end: false },
  { to: "/tokens", label: "API tokens", icon: KeyRound, end: false },
  { to: "/usage", label: "Usage", icon: BarChart3, end: false },
];

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function onLogout() {
    await logout();
    queryClient.clear();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-full w-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
        <div className="flex h-14 items-center gap-2 border-b border-zinc-800 px-4">
          <Boxes className="size-5 text-emerald-400" />
          <span className="text-sm font-semibold tracking-wide">agents</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-zinc-800/60 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        {user && (
          <div className="border-t border-zinc-800 p-2">
            <div className="px-2.5 py-1.5 text-xs text-zinc-500">
              <div className="truncate text-zinc-300">{user.name}</div>
              <div className="truncate font-mono">{user.email}</div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </div>
        )}
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto bg-zinc-900">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
