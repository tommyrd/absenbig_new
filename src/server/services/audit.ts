import type { DatabaseSync } from 'node:sqlite';
import type { Request } from 'express';
import type { AuthUser } from '../../shared/types.ts';
import { getWibIsoString } from '../time.ts';
import { getClientIp } from '../security.ts';

export interface AuditParams {
  actor: AuthUser | { id: number; nama_lengkap: string; role: string };
  req?: Request;
  modul: string;
  aksi: string;
  targetEntity: string;
  targetId: string | number;
  karyawanId?: number | null;
  tanggalTerdampak?: string | null;
  before?: unknown;
  after?: unknown;
  alasan?: string | null;
  refAuditId?: number | null;
}

export function writeAuditLog(db: DatabaseSync, params: AuditParams): number {
  const actorName = 'nama_lengkap' in params.actor ? params.actor.nama_lengkap : 'System';
  const ip = params.req ? getClientIp(params.req) : '127.0.0.1';
  const ua = params.req?.headers['user-agent']?.toString() || 'Server';

  const stmt = db.prepare(`
    INSERT INTO audit_log (
      actor_id, actor_name, actor_role, waktu_server, ip_address, user_agent,
      modul, aksi, target_entity, target_id, karyawan_id, tanggal_terdampak,
      before_json, after_json, alasan, ref_audit_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    params.actor.id,
    actorName,
    params.actor.role,
    getWibIsoString(),
    ip,
    ua,
    params.modul,
    params.aksi,
    params.targetEntity,
    String(params.targetId),
    params.karyawanId ?? null,
    params.tanggalTerdampak ?? null,
    params.before !== undefined ? JSON.stringify(params.before) : null,
    params.after !== undefined ? JSON.stringify(params.after) : null,
    params.alasan ?? null,
    params.refAuditId ?? null
  );

  return Number(info.lastInsertRowid);
}
