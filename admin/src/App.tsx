import { useEffect, useState } from "react";
import { api, ApiError } from "./lib/api";
import type { Settings, User } from "./lib/types";
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

const NAV: Array<{ hash: string; label: string }> = [
  { hash: "#/dashboard", label: "Dashboard" },
  { hash: "#/posts", label: "Posts" },
  { hash: "#/pages", label: "Pages" },
  { hash: "#/media", label: "Media" },
  { hash: "#/terms", label: "Categories & Tags" },
  { hash: "#/comments", label: "Comments" },
  { hash: "#/menus", label: "Menus" },
  { hash: "#/users", label: "Users" },
  { hash: "#/settings", label: "Settings" },
  { hash: "#/health", label: "Site Health" },
  { hash: "#/activity", label: "Activity" },
  { hash: "#/conversion", label: "Conversion" },
  { hash: "#/themes", label: "Themes" },
  { hash: "#/ai", label: "AI" },
  { hash: "#/seo", label: "SEO" },
  { hash: "#/studio", label: "Content Studio" },
  { hash: "#/commerce", label: "Commerce" },
  { hash: "#/integrations", label: "Integrations" },
  { hash: "#/security", label: "Security" },
  { hash: "#/backup", label: "Backup" },
  { hash: "#/import", label: "Import" },
];

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

  useEffect(() => {
    const onHash = (): void => setRoute(routeFromHash());
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
        <p className="muted">Loading Wordless admin…</p>
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
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>Wordless</h1>
          <p>{settings?.siteTitle ?? "Admin"}</p>
        </div>
        <nav>
          {NAV.map((item) => (
            <a
              key={item.hash}
              href={item.hash}
              className={section === item.hash.replace("#/", "") ? "active" : ""}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <p style={{ margin: "0 0 8px" }}>
            Signed in as <strong>{user.displayName}</strong>
            <br />
            <span className="muted">{user.role}</span>
          </p>
          <button type="button" onClick={() => void logout()}>
            Log out
          </button>
          <p style={{ margin: "12px 0 0" }}>
            <a href="/" target="_blank" rel="noreferrer" style={{ color: "var(--sidebar-text-dim)" }}>
              View site ↗
            </a>
          </p>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <h2>{pageTitle(route)}</h2>
          <span className="who">{user.login}</span>
        </header>
        <main className="content">{page}</main>
      </div>
    </div>
  );
}
