import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export class DatabaseUnavailableError extends Error {
  public constructor() {
    super('DATABASE_URL is not configured');
    this.name = 'DatabaseUnavailableError';
  }
}

export interface DbAdapter extends Queryable {
  withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class PostgresAdapter implements DbAdapter {
  public constructor(private readonly pool: Pool) {}

  public query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  public async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createDbAdapter(databaseUrl?: string): DbAdapter | null {
  if (!databaseUrl) {
    return null;
  }

  return new PostgresAdapter(
    new Pool({
      connectionString: databaseUrl
    })
  );
}
