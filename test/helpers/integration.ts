import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';

export function buildTestDatabaseName(): string {
  return `marathon_lfg_test_${randomUUID().replaceAll('-', '')}`;
}

export function buildDatabaseUrl(baseDatabaseUrl: string, databaseName: string): string {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export async function createIsolatedDatabase(baseDatabaseUrl: string, databaseName: string): Promise<void> {
  const adminPool = new Pool({ connectionString: baseDatabaseUrl });

  try {
    await adminPool.query(`create database ${databaseName}`);
  } finally {
    await adminPool.end();
  }
}

export async function dropIsolatedDatabase(baseDatabaseUrl: string, databaseName: string): Promise<void> {
  const adminPool = new Pool({ connectionString: baseDatabaseUrl });

  try {
    await adminPool.query(
      `
        select pg_terminate_backend(pid)
        from pg_stat_activity
        where datname = $1
          and pid <> pg_backend_pid()
      `,
      [databaseName]
    );
    await adminPool.query(`drop database if exists ${databaseName}`);
  } finally {
    await adminPool.end();
  }
}

export async function applyMigration(databaseUrl: string): Promise<void> {
  const migrationSql = await readFile(new URL('../../migrations/0001_init.sql', import.meta.url), 'utf8');
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(migrationSql);
  } finally {
    await pool.end();
  }
}

export async function seedVerifiedUser(
  databaseUrl: string,
  input: {
    userId: string;
    bungieMembershipId: string;
    marathonMembershipId: string;
    displayName: string;
    displayNameCode: number;
  }
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(
      `
        insert into app_users (id, is_active)
        values ($1::uuid, true)
      `,
      [input.userId]
    );

    await pool.query(
      `
        insert into bungie_accounts (
          user_id,
          bungie_membership_id,
          bungie_display_name,
          bungie_global_display_name,
          bungie_global_display_name_code,
          bungie_verified,
          bungie_verified_at,
          marathon_membership_id,
          marathon_verified,
          marathon_verified_at,
          last_membership_sync_at,
          raw_membership_payload
        )
        values (
          $1::uuid,
          $2::bigint,
          $3,
          $3,
          $4,
          true,
          now(),
          $5::bigint,
          true,
          now(),
          now(),
          jsonb_build_object('source', 'integration-test', 'userId', $1::text)
        )
      `,
      [
        input.userId,
        input.bungieMembershipId,
        input.displayName,
        input.displayNameCode,
        input.marathonMembershipId
      ]
    );
  } finally {
    await pool.end();
  }
}
