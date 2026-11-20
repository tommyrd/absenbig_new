import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn } from 'lucide-react';
import { getAuthorizedAvatarUrl, getAuthorizedUserAvatarUrl } from '../lib/api';

interface UserAvatarProps {
  karyawanId?: number | null;
  userId?: number | null;
  name: string;
  role?: string;
  subtitle?: string | null;
  version?: string | null;
  srcOverride?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  previewable?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<UserAvatarProps['size']>, string> = {
  xs: 'w-7 h-7 text-[10px] rounded-lg',
  sm: 'w-8 h-8 text-xs rounded-lg',
  md: 'w-10 h-10 text-xs rounded-xl',
  lg: 'w-12 h-12 text-sm rounded-xl',
  xl: 'w-20 h-20 text-xl rounded-2xl',
};

function getRoleMeta(role?: string): { label: string; cls: string } | null {
  if (role === 'SUPERADMIN') {
    return {
      label: 'Superadmin',
      cls: 'bg-amber-500/20 text-amber-200 border border-amber-400/35',
    };
  }
  if (role === 'ADMIN') {
    return {
      label: 'Operator',
      cls: 'bg-brand-500/25 text-brand-100 border border-brand-400/35',
    };
  }
  if (role === 'KARYAWAN') {
    return {
      label: 'Karyawan',
      cls: 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/35',
    };
  }
  return null;
}

export function UserAvatar({
  karyawanId,
  userId,
  name,
  role,
  subtitle,
  version,
  srcOverride,
  size = 'md',
  previewable = true,
  className = '',
}: UserAvatarProps) {
  const [failed, setFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const initials =
    (name || 'BG')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || 'BG';

  const imgSrc =
    srcOverride ||
    (karyawanId
      ? getAuthorizedAvatarUrl(karyawanId, version)
      : userId
      ? getAuthorizedUserAvatarUrl(userId, version)
      : null);

  useEffect(() => {
    setFailed(false);
  }, [imgSrc]);

  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewOpen]);

  const fallbackBg =
    role === 'SUPERADMIN'
      ? 'bg-brand-950 text-amber-300 border border-amber-400/30'
      : role === 'ADMIN'
      ? 'bg-[#c0392b] text-white'
      : 'bg-brand-800 text-white';

  const sizeCls = SIZE_CLASSES[size];
  const roleMeta = getRoleMeta(role);

  const handleOpenPreview = (e: MouseEvent) => {
    if (!previewable) return;
    e.preventDefault();
    e.stopPropagation();
    setPreviewOpen(true);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!previewable) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      setPreviewOpen(true);
    }
  };

  const interactiveCls = previewable
    ? 'cursor-pointer transition-all hover:opacity-95 hover:ring-2 hover:ring-brand-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
    : '';

  const avatarElement =
    imgSrc && !failed ? (
      <img
        src={imgSrc}
        alt={`Foto profil ${name}`}
        title={previewable ? `Klik untuk lihat foto profil ${name}` : undefined}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        onClick={previewable ? handleOpenPreview : undefined}
        onKeyDown={previewable ? handleKeyDown : undefined}
        role={previewable ? 'button' : undefined}
        tabIndex={previewable ? 0 : undefined}
        className={`${sizeCls} object-cover shrink-0 bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 ${interactiveCls} ${className}`}
      />
    ) : (
      <div
        aria-label={previewable ? `Lihat foto profil ${name}` : `Inisial ${name}`}
        title={previewable ? `Klik untuk lihat profil ${name}` : undefined}
        onClick={previewable ? handleOpenPreview : undefined}
        onKeyDown={previewable ? handleKeyDown : undefined}
        role={previewable ? 'button' : undefined}
        tabIndex={previewable ? 0 : undefined}
        className={`${sizeCls} ${fallbackBg} flex items-center justify-center font-display font-bold shrink-0 ${interactiveCls} ${className}`}
      >
        {initials}
      </div>
    );

  const modal =
    previewOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={(e) => {
              e.stopPropagation();
              setPreviewOpen(false);
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`Foto profil ${name}`}
          >
            <div
              className="relative w-full max-w-sm flex flex-col items-center gap-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-full flex items-center justify-between gap-3 text-white">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display text-base font-bold text-white truncate">
                      {name}
                    </h3>
                    {roleMeta && (
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${roleMeta.cls}`}
                      >
                        {roleMeta.label}
                      </span>
                    )}
                  </div>
                  {subtitle && (
                    <p className="text-xs text-slate-300 truncate mt-0.5">{subtitle}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewOpen(false);
                  }}
                  className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center shrink-0 transition-colors"
                  aria-label="Tutup pratinjau foto profil"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="w-full aspect-square max-w-[360px] rounded-2xl overflow-hidden bg-slate-900 border border-white/15 shadow-2xl flex items-center justify-center">
                {imgSrc && !failed ? (
                  <img
                    src={imgSrc}
                    alt={`Foto profil ${name}`}
                    referrerPolicy="no-referrer"
                    onError={() => setFailed(true)}
                    className="w-full h-full object-contain bg-slate-900"
                  />
                ) : (
                  <div
                    className={`w-full h-full ${fallbackBg} flex items-center justify-center font-display text-6xl font-bold`}
                  >
                    {initials}
                  </div>
                )}
              </div>

              <p className="text-[11px] text-slate-400 inline-flex items-center gap-1.5">
                <ZoomIn className="w-3.5 h-3.5" />
                Ketuk di luar foto atau tekan ESC untuk menutup
              </p>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {avatarElement}
      {modal}
    </>
  );
}
