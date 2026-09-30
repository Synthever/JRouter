"use client";

import React from "react";
import {
  CircleUser, GitFork, Plus, Code2, Key, LayoutGrid, ArrowLeft,
  ArrowDown, ArrowRight, ArrowUp, FileText, Paperclip, DollarSign,
  Sparkles, BarChart3, Ban, Zap, Paintbrush, Building2, XCircle,
  Cast, MessageSquare, Check, CheckCircle2, ListChecks, ChevronLeft,
  ChevronRight, X, Cloud, CloudOff, CloudUpload, Code, Monitor,
  Copy, Contrast, Cookie, Moon, Binary, FileJson, Activity,
  Trash2, Laptop, Server, Download, Pencil, FileEdit, AlertCircle,
  ChevronUp, ChevronDown, Puzzle, Upload, FilterX, FolderOpen,
  Sigma, Gavel, AudioWaveform, Users, HelpCircle, History,
  Hourglass, Network, Image, Search, Info, LogIn, Globe,
  Layers, Sun, Link, Unlink, List, Lock, Unlock, LogOut,
  Cpu, Menu, BookOpen, Mic, Film, Music, Brain, ExternalLink,
  PauseCircle, Images, User, Play, PlayCircle, ListPlus,
  PowerOff, Power, Loader2, QrCode, Circle, AudioLines,
  RefreshCw, RotateCcw, Rocket, Route, Save, PiggyBank,
  ScatterChart, Clock, FlaskConical, SearchX, Shield, Send,
  Settings, ShieldAlert, Bot, Star, Square, StopCircle,
  ArrowLeftRight, Table, Terminal, ToggleLeft, ToggleRight,
  Languages, Compass, FileUp, BadgeCheck, ShieldCheck, Box,
  Eye, EyeOff, HeartHandshake, AlertTriangle, Wifi, WifiOff,
  Radio, LayoutDashboard, ArrowUpDown, TrendingUp, PieChart,
  Inbox, PanelLeftClose, PanelLeftOpen, PanelLeft
} from "lucide-react";
import { cn } from "@/shared/utils/cn";

const ICON_MAP = {
  // Navigation & Actions
  "menu": Menu,
  "panel_left": PanelLeft,
  "panel-left": PanelLeft,
  "panel_left_close": PanelLeftClose,
  "panel-left-close": PanelLeftClose,
  "panel_left_open": PanelLeftOpen,
  "panel-left-open": PanelLeftOpen,
  "close": X,
  "check": Check,
  "check_circle": CheckCircle2,
  "radio_button_unchecked": Circle,
  "add": Plus,
  "delete": Trash2,
  "edit": Pencil,
  "edit_note": FileEdit,
  "search": Search,
  "search_off": SearchX,
  "refresh": RefreshCw,
  "restart_alt": RotateCcw,
  "restore": RotateCcw,
  "sync": RefreshCw,
  "sync_alt": ArrowLeftRight,
  "history": History,
  "save": Save,
  "send": Send,
  "content_copy": Copy,
  "download": Download,
  "upload": Upload,
  "upload_file": FileUp,
  "file_upload": Upload,
  "cloud_upload": CloudUpload,
  "cloud_off": CloudOff,
  "cloud": Cloud,
  "filter_alt_off": FilterX,
  "inbox": Inbox,

  // Arrows & Chevrons
  "arrow_back": ArrowLeft,
  "arrow_forward": ArrowRight,
  "arrow_upward": ArrowUp,
  "arrow_downward": ArrowDown,
  "chevron_left": ChevronLeft,
  "chevron_right": ChevronRight,
  "expand_more": ChevronDown,
  "expand_less": ChevronUp,
  "keyboard_arrow_down": ChevronDown,
  "keyboard_arrow_up": ChevronUp,
  "swap_calls": ArrowUpDown,
  "swap_vert": ArrowUpDown,

  // Controls & Status
  "power_settings_new": Power,
  "power_off": PowerOff,
  "play_arrow": Play,
  "play_circle": PlayCircle,
  "pause_circle": PauseCircle,
  "stop": Square,
  "stop_circle": StopCircle,
  "progress_activity": Loader2,
  "toggle_off": ToggleLeft,
  "toggle_on": ToggleRight,

  // Security & Auth
  "lock": Lock,
  "lock_open": Unlock,
  "login": LogIn,
  "logout": LogOut,
  "key": Key,
  "api_key": Key,
  "vpn_key": Key,
  "vpn_lock": ShieldCheck,
  "shield": Shield,
  "shield_lock": ShieldAlert,
  "security": Shield,
  "verified": BadgeCheck,
  "verified_user": ShieldCheck,
  "gavel": Gavel,

  // Alerts & Notifications
  "warning": AlertTriangle,
  "error": AlertCircle,
  "cancel": XCircle,
  "info": Info,
  "help": HelpCircle,
  "block": Ban,
  "bolt": Zap,

  // Devices, Network & System
  "computer": Monitor,
  "desktop_windows": Monitor,
  "monitor": Monitor,
  "devices": Laptop,
  "lan": Network,
  "hub": Network,
  "dns": Server,
  "terminal": Terminal,
  "code": Code,
  "api": Code2,
  "link": Link,
  "link_off": Unlink,
  "open_in_new": ExternalLink,
  "wifi": Wifi,
  "wifi_off": WifiOff,
  "wifi_tethering": Radio,
  "route": Route,
  "input": LogIn,
  "output": LogOut,
  "cast": Cast,

  // UI, Layout & Views
  "apps": LayoutGrid,
  "grid_view": LayoutGrid,
  "table_rows": Table,
  "list_alt": List,
  "checklist": ListChecks,
  "playlist_add": ListPlus,
  "layers": Layers,
  "space_dashboard": LayoutDashboard,
  "layout-dashboard": LayoutDashboard,
  "layout_dashboard": LayoutDashboard,
  "layoutdashboard": LayoutDashboard,
  "dashboard": LayoutDashboard,
  "contrast": Contrast,
  "light": Sun,
  "light_mode": Sun,
  "dark": Moon,
  "dark_mode": Moon,
  "settings": Settings,

  // Analytics & Data
  "bar_chart": BarChart3,
  "data_usage": Activity,
  "data_array": Binary,
  "data_object": FileJson,
  "monitoring": Activity,
  "scatter_plot": ScatterChart,
  "memory": Cpu,
  "hourglass_top": Hourglass,
  "schedule": Clock,
  "timeline": TrendingUp,
  "pie_chart": PieChart,

  // Media, AI & Concepts
  "image": Image,
  "image_search": Search,
  "perm_media": Images,
  "movie": Film,
  "music_note": Music,
  "mic": Mic,
  "graphic_eq": AudioWaveform,
  "record_voice_over": AudioLines,
  "brush": Paintbrush,
  "psychology": Brain,
  "neurology": Brain,
  "smart_toy": Bot,
  "science": FlaskConical,
  "rocket_launch": Rocket,
  "volunteer_activism": HeartHandshake,
  "savings": PiggyBank,
  "attach_money": DollarSign,
  "attach_file": Paperclip,
  "folder_open": FolderOpen,
  "cookie": Cookie,
  "account_circle": CircleUser,
  "account_tree": GitFork,
  "person": User,
  "group": Users,
  "business": Building2,
  "language": Globe,
  "translate": Languages,
  "travel_explore": Compass,
  "explore": Compass,
  "public": Globe,
  "qr_code_scanner": QrCode,
  "star": Star,
  "stars": Sparkles,
  "extension": Puzzle,
  "menu_book": BookOpen,
  "chat": MessageSquare,
  "visibility": Eye,
  "visibility_off": EyeOff,
  "sparkles": Sparkles,
  "auto_awesome": Sparkles,
  "functions": Sigma,
  "view_in_ar": Box,
  "article": FileText,
};

export default function Icon({
  name,
  children,
  size,
  className,
  style,
  strokeWidth = 2,
  ...props
}) {
  if (React.isValidElement(name)) return name;
  if (React.isValidElement(children)) return children;
  if (typeof name === "function") {
    const Comp = name;
    return <Comp size={size || "1em"} className={cn("inline-block shrink-0 align-middle", className)} style={style} {...props} />;
  }
  if (typeof children === "function") {
    const Comp = children;
    return <Comp size={size || "1em"} className={cn("inline-block shrink-0 align-middle", className)} style={style} {...props} />;
  }

  const raw = name || (typeof children === "string" ? children.trim() : (Array.isArray(children) ? children.filter(c => typeof c === "string").join("").trim() : ""));
  if (!raw || typeof raw !== "string") return null;

  const key = raw.trim().toLowerCase();
  const underscoreKey = key.replace(/-/g, "_");
  const hyphenKey = key.replace(/_/g, "-");
  const Component = ICON_MAP[key] || ICON_MAP[hyphenKey] || ICON_MAP[underscoreKey] || ICON_MAP[raw.trim()] || HelpCircle;

  return (
    <Component
      size={size || "1em"}
      className={cn("inline-block shrink-0 align-middle", className)}
      style={style}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}

export { Icon, ICON_MAP };
