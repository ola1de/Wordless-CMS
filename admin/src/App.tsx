import { useEffect, useState } from "react";
import { api, ApiError } from "./lib/api";
import type { Settings, User } from "./lib/types";
import { Icon, LogoMark } from "./components/icons";
import type { IconName } from "./components/icons";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { PostsPage } from "./pages/Posts";
import { EditorPage } from "./pages/Editor";
import { MediaPage } from "./pages/Media";
import { TermsPage } from "./pages/Terms";
import { CommentsPage } from "./pages/Comments";
import { MenusPage } from "./pages/Menus";
import { UsersPage } from "./pages/Users";
import { SettingsPage } from "./pages/Settings";
import { HealthPage } from "./pages/Health";
import { ActivityPage } from "./pages/Activity";
import { ConversionPage } from "./pages/Conversion";
import { ThemeEditorPage } from "./pages/ThemeEditor";
import { CommandCentrePage } from "./pages/CommandCentre";
import { SeoPage } from "./pages/Seo";
import { StudioPage } from "./pages/Studio";
import { CommercePage } from "./pages/Commerce";
import { IntegrationsPage } from "./pages/Integrations";
import { SecurityPage } from "./pages/Security";
import { BackupPage } from "./pages/Backup";
import { ImportPage } from "./pages/Import";

export interface AppSettings {
  timezone: string;
  permalinkStructure: string;
  siteTitle: string;
}

const NAV: Array<{ hash: string; label: string; icon: IconName; group: string }> = [
  { hash: "#/dashboard", label: "Dashboard", icon: "dashboard", group: "Content" },
  { hash: "#/posts", label: "Posts", icon: "posts", group: "Content" },
  { hash: "#/pages", label: "Pages", icon: "pages", group: "Content" },
  { hash: "#/media", label: "Media", icon: "media", group: "Content" },
  { hash: "#/terms", label: "Categories & Tags", icon: "terms", group: "Content" },
  { hash: "#/comments", label: "Comments", icon: "comments", group: "Content" },
  { hash: "#/menus", label: "Menus", icon: "menus", group: "Content" },
  { hash: "#/users", label: "Users", icon: "users", group: "Site" },
  { hash: "#/settings", label: "Settings", icon: "settings", group: "Site" },
  { hash: "#/health", label: "Site Health", icon: "health", group: "Site" },
  { hash: "#/activity", label: "Activity", icon: "activity", group: "Site" },
  { hash: "#/themes", label: "Themes", icon: "themes", group: "Site" },
  { hash: "#/ai", label: "AI", icon: "ai", group: "Grow" },
  { hash: "#/seo", label: "SEO", icon: "seo", group: "Grow" },
  { hash: "#/studio", label: "Content Studio", icon: "studio", group: "Grow" },
  { hash: "#/commerce", label: "Commerce", icon: "commerce", group: "Grow" },
  { hash: "#/integrations", label: "Integrations", icon: "integrations", group: "Grow" },
  { hash: "#/conversion", label: "Conversion", icon: "conversion", group: "System" },
  { hash: "#/security", label: "Security", icon: "security", group: "System" },
  { hash: "#/backup", label: "Backup", icon: "backup", group: "System" },
  { hash: "#/import", label: "Import", icon: "import", group: "System" },
];

const NAV_GROUPS = ["Content", "Site", "Grow", "System"];

function routeFromHash(): string {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return hash === "" ? "dashboard" : hash;
}

function pageTitle(route: string): string {
  const item = NAV.find((n) => n.hash === `#/${route.split("/")[0] ?? ""}`);
  if (route.startsWith("posts/new")) return "New Post";
  if (route.startsWith("posts/")) return "Edit Post";
  if (route.startsWith("pages/new")) return "New Page";
  if (route.startsWith("pages/")) return "Edit Page";
  return item?.label ?? "Dashboard";
}

export function App(): React.ReactElement {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [checking, setChecking] = useState(true);
  const [route, setRoute] = useState(routeFromHash());
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const onHash = (): void => {
      setRoute(routeFromHash());
      setNavOpen(false);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then(async ({ user: me }) => {
        if (cancelled) return;
        setUser(me);
        try {
          const s: Settings = await api.getSettings();
          if (!cancelled) {
            setSettings({ timezone: s.timezone, permalinkStructure: s.permalinkStructure, siteTitle: s.siteTitle });
          }
        } catch {
          // Settings need manage_options; editors can still use the admin.
          if (!cancelled) setSettings({ timezone: "UTC", permalinkStructure: "postname", siteTitle: "Wordless" });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof ApiError && err.status === 401)) {
          // Any failure to check the session → treat as logged out.
        }
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const go = (hash: string): void => {
    window.location.hash = hash;
  };

  if (checking) {
    return (
      <div className="login-wrap">
        <div className="spinner-row">
          <span className="spinner" aria-hidden="true" />
          <span style={{ color: "rgba(255,255,255,0.75)" }}>Loading Wordless admin…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        onLoggedIn={(me) => {
          setUser(me);
          go("#/dashboard");
        }}
      />
    );
  }

  const logout = async (): Promise<void> => {
    try {
      await api.logout();
    } catch {
      // Ignore logout errors; the session cookie is cleared server-side on success.
    }
    setUser(null);
    go("#/login");
  };

  const [section, ...rest] = route.split("/");
  const tz = settings?.timezone ?? "UTC";
  const permalinkStructure = settings?.permalinkStructure ?? "postname";

  let page: React.ReactElement;
  switch (section) {
    case "posts":
      if (rest[0] === "new") {
        page = <EditorPage type="post" settings={{ timezone: tz, permalinkStructure }} onDone={() => go("#/posts")} />;
      } else if (rest[0]) {
        page = (
          <EditorPage
            type="post"
            postId={Number(rest[0])}
            settings={{ timezone: tz, permalinkStructure }}
            onDone={() => go("#/posts")}
          />
        );
      } else {
        page = <PostsPage type="post" timezone={tz} />;
      }
      break;
    case "pages":
      if (rest[0] === "new") {
        page = <EditorPage type="page" settings={{ timezone: tz, permalinkStructure }} onDone={() => go("#/pages")} />;
      } else if (rest[0]) {
        page = (
          <EditorPage
            type="page"
            postId={Number(rest[0])}
            settings={{ timezone: tz, permalinkStructure }}
            onDone={() => go("#/pages")}
          />
        );
      } else {
        page = <PostsPage type="page" timezone={tz} />;
      }
      break;
    case "media":
      page = <MediaPage />;
      break;
    case "terms":
      page = <TermsPage />;
      break;
    case "comments":
      page = <CommentsPage timezone={tz} />;
      break;
    case "menus":
      page = <MenusPage />;
      break;
    case "users":
      page = <UsersPage currentUser={user} />;
      break;
    case "settings":
      page = <SettingsPage onSaved={setSettings} />;
      break;
    case "health":
      page = <HealthPage />;
      break;
    case "activity":
      page = <ActivityPage timezone={tz} />;
      break;
    case "conversion":
      page = <ConversionPage />;
      break;
    case "themes":
      page = <ThemeEditorPage />;
      break;
    case "ai":
      page = <CommandCentrePage />;
      break;
    case "seo":
      page = <SeoPage />;
      break;
    case "studio":
      page = <StudioPage />;
      break;
    case "commerce":
      page = <CommercePage />;
      break;
    case "integrations":
      page = <IntegrationsPage />;
      break;
    case "security":
      page = <SecurityPage />;
      break;
    case "backup":
      page = <BackupPage />;
      break;
    case "import":
      page = <ImportPage />;
      break;
    case "dashboard":
    default:
      page = <DashboardPage timezone={tz} />;
      break;
  }

  return (
    <div className={`app-shell${navOpen ? " nav-open" : ""}`}>
      {navOpen ? (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      <aside className="sidebar">
        <div className="brand">
          <LogoMark size={40} />
          <div className="wordmark">
            <h1>Wordless</h1>
            <p>{settings?.siteTitle ?? "Admin"}</p>
          </div>
        </div>
        <nav>
          {NAV_GROUPS.map((group) => (
            <div key={group}>
              <div className="nav-section">{group}</div>
              {NAV.filter((item) => item.group === group).map((item) => (
                <a
                  key={item.hash}
                  href={item.hash}
                  className={section === item.hash.replace("#/", "") ? "active" : ""}
                >
                  <Icon name={item.icon} size={18} />
                  {item.label}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-user">
            <span className="avatar" aria-hidden="true">
              {initials(user.displayName)}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="who-name">{user.displayName}</div>
              <div className="who-role">{user.role}</div>
            </div>
          </div>
          <button type="button" onClick={() => void logout()}>
            <Icon name="logout" size={16} />
            Log out
          </button>
          <a className="side-link" href="/" target="_blank" rel="noreferrer">
            View site <Icon name="external" size={14} />
          </a>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="menu-btn icon-btn"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
          >
            <Icon name="menu" size={20} />
          </button>
          <h2>{pageTitle(route)}</h2>
          <span className="who">
            <span className="avatar light" aria-hidden="true">
              {initials(user.displayName)}
            </span>
            <span className="who-name">{user.login}</span>
          </span>
        </header>
        <main className="content">{page}</main>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "W";
  const first = parts[0]?.[0] ?? "W";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}
