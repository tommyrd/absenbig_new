/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState } from 'react';
import { apiFetch, getStoredToken, logoutApi } from './lib/api';
import { useResetScroll } from './lib/scroll';
import { initServerClock } from './lib/server-clock-client';
import { useTheme } from './lib/theme';
import type { AuthUser, SystemSettings } from './shared/types';
import { LoginView } from './components/LoginView';
import { EmployeeShell } from './components/employee/EmployeeShell';
import { AdminShell } from './components/admin/AdminShell';
import { SuperadminConsole } from './components/superadmin/SuperadminConsole';

export default function App() {
  useTheme();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  // Reset viewport strictly to top whenever auth state or role changes
  useResetScroll([user?.id ?? null, user?.role ?? null, checking]);

  useEffect(() => {
    const clockPromise = initServerClock().catch(() => false);
    const settingsPromise = apiFetch<{ settings: SystemSettings | null }>('/api/v1/settings/public')
      .then((res) => {
        if (res.settings) {
          setSettings(res.settings);
          document.title = `${res.settings.nama_aplikasi} — Sistem Kehadiran & Rekap Payroll`;
        }
      })
      .catch(() => {});

    const token = getStoredToken();
    const authPromise = token
      ? apiFetch<{ user: AuthUser }>('/api/v1/auth/me')
          .then((res) => setUser(res.user))
          .catch(() => setUser(null))
      : Promise.resolve();

    void Promise.all([clockPromise, settingsPromise, authPromise]).finally(() => {
      setChecking(false);
    });
  }, []);

  useEffect(() => {
    let faviconLink = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!faviconLink) {
      faviconLink = document.createElement('link');
      faviconLink.rel = 'icon';
      document.head.appendChild(faviconLink);
    }
    faviconLink.href = `/api/v1/assets/favicon?v=${encodeURIComponent(
      settings?.favicon_updated_at || 'default'
    )}`;
    faviconLink.removeAttribute('type');
  }, [settings]);

  const handleSettingsUpdated = (next: SystemSettings) => {
    setSettings(next);
    document.title = `${next.nama_aplikasi} — Sistem Kehadiran & Rekap Payroll`;
  };

  const handleLogout = async () => {
    await logoutApi();
    setUser(null);
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-brand-600 dark:border-brand-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Memverifikasi sesi Absensi BIGNET...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginView settings={settings} onSuccess={(u) => setUser(u)} />;
  }

  if (user.role === 'SUPERADMIN') {
    return (
      <SuperadminConsole
        user={user}
        settings={settings}
        onUserUpdated={(u) => setUser(u)}
        onSettingsUpdated={handleSettingsUpdated}
        onLogout={handleLogout}
      />
    );
  }

  if (user.role === 'ADMIN') {
    return (
      <AdminShell
        user={user}
        settings={settings}
        onUserUpdated={(u) => setUser(u)}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <EmployeeShell
      user={user}
      settings={settings}
      onUserUpdated={(u) => setUser(u)}
      onLogout={handleLogout}
    />
  );
}
