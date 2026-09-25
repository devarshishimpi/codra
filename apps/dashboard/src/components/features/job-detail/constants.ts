import {
  AlertCircle,
  AlertTriangle,
  Lightbulb,
  Code2,
  MessageSquare,
} from "lucide-react";
import type { ElementType } from "react";

export const severityConfig: Record<
  string,
  {
    svg?: string;
    icon: ElementType;
    bg: string;
    border: string;
    text: string;
    iconColor: string;
  }
> = {
  P0: {
    svg: "/icons/p0-icon.svg",
    icon: AlertCircle,
    bg: "bg-danger-bg",
    border: "border-danger/30",
    text: "text-danger",
    iconColor: "text-danger",
  },
  P1: {
    svg: "/icons/p1-icon.svg",
    icon: AlertTriangle,
    bg: "bg-warning-bg",
    border: "border-warning/30",
    text: "text-warning",
    iconColor: "text-warning",
  },
  P2: {
    svg: "/icons/p2-icon.svg",
    icon: Lightbulb,
    bg: "bg-warning-bg/40",
    border: "border-warning/20",
    text: "text-warning/80",
    iconColor: "text-warning/60",
  },
  P3: {
    svg: "/icons/p3-icon.svg",
    icon: Code2,
    bg: "bg-info-bg",
    border: "border-info/30",
    text: "text-info",
    iconColor: "text-info",
  },
  nit: {
    svg: "/icons/nit-icon.svg",
    icon: MessageSquare,
    bg: "bg-secondary/40",
    border: "border-border/40",
    text: "text-muted-foreground",
    iconColor: "text-muted-foreground",
  },
};
