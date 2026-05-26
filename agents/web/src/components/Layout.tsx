import { NavLink, Outlet } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Boxes,
  Bot,
  FolderGit2,
  GitPullRequest,
  PlugZap,
  Sparkles,
  Wrench,
} from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Bot;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/agents", label: "Agents", icon: Bot, end: false },
  { to: "/sessions", label: "Sessions", icon: Activity, end: false },
  { to: "/connectors", label: "Connectors", icon: PlugZap, end: false },
  { to: "/skills", label: "Skills", icon: Sparkles, end: false },
  { to: "/mcp-servers", label: "MCP servers", icon: Wrench, end: false },
  { to: "/repos", label: "Repos", icon: FolderGit2, end: false },
  { to: "/pr-activity", label: "PR activity", icon: GitPullRequest, end: false },
  { to: "/usage", label: "Usage", icon: BarChart3, end: false },
];

export function Layout() {
  return (
    <div className="flex h-full w-full">
      <aside className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-950">
        <div className="flex h-14 items-center gap-2 border-b border-zinc-800 px-4">
          <Boxes className="size-5 text-emerald-400" />
          <span className="text-sm font-semibold tracking-wide">agents</span>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
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
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto bg-zinc-900">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
