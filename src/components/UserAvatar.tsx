import { useState } from 'react';
import { getAuthorizedAvatarUrl, getAuthorizedUserAvatarUrl } from '../lib/api';

interface UserAvatarProps {
  karyawanId?: number | null;
  userId?: number | null;
  name: string;
  role?: string;
  version?: string | null;
  srcOverride?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<UserAvatarProps['size']>, string> = {
  xs: 'w-7 h-7 text-[10px] rounded-lg',
  sm: 'w-8 h-8 text-xs rounded-lg',
  md: 'w-10 h-10 text-xs rounded-xl',
  lg: 'w-12 h-12 text-sm rounded-xl',
  xl: 'w-20 h-20 text-xl rounded-2xl',
};

export function UserAvatar({
  karyawanId,
  userId,
  name,
  role,
  version,
  srcOverride,
  size = 'md',
  className = '',
}: UserAvatarProps) {
  const [failed, setFailed] = useState(false);

  const initials =
    (name || 'BG')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || 'BG';

  const imgSrc =
    srcOverride ||
    (karyawanId ? getAuthorizedAvatarUrl(karyawanId, version) : userId ? getAuthorizedUserAvatarUrl(userId, version) : null);

  const fallbackBg =
    role === 'SUPERADMIN'
      ? 'bg-navy-950 text-amber-300 border border-amber-400/30'
      : role === 'ADMIN'
      ? 'bg-blue-700 text-white'
      : 'bg-navy-900 text-white';

  const sizeCls = SIZE_CLASSES[size];

  if (imgSrc && !failed) {
    return (
      <img
        src={imgSrc}
        alt={`Foto profil ${name}`}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${sizeCls} object-cover shrink-0 bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 ${className}`}
      />
    );
  }

  return (
    <div
      aria-label={`Inisial ${name}`}
      className={`${sizeCls} ${fallbackBg} flex items-center justify-center font-display font-bold shrink-0 ${className}`}
    >
      {initials}
    </div>
  );
}
