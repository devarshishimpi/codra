import {
  LayoutDashboard,
  GitBranch,
  BarChart2,
  Activity,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ApiAction } from "@codraoss/schema/api";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  requiresAction?: ApiAction;
}

// The sidebar's contents, kept here so navigation can be extended by composing this list; /account is intentionally absent because it lives in the account menu.
export const navItems: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/jobs", label: "Jobs", icon: Activity, end: false },
  { to: "/repos", label: "Repos", icon: GitBranch, end: false },
  { to: "/stats", label: "Stats", icon: BarChart2, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
];
