import { z } from 'zod';
import Database from 'better-sqlite3';
import type { ToolContext, ToolResult } from './types.js';
import { resolveWithinWorkspace, trimOutput } from './utils.js';

const schema = z.object({
  path: z.string().describe('Path to the SQLite database file (relative to workspace or absolute)'),
  query: z.string().describe('SQL query to execute (read-only)'),
});

async function execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const { path: dbPath, query } = args as { path: string; query: string };
  const { resolved, error } = await resolveWithinWorkspace(dbPath, ctx);
  if (error) return error;

  if (!resolved.endsWith('.sqlite') && !resolved.endsWith('.db') && !resolved.endsWith('.sqlite3')) {
    return { error: 'Invalid database file extension. Must be .sqlite, .db, or .sqlite3', label: 'blocked' };
  }

  let db: Database.Database;
  try {
    db = new Database(resolved, { readonly: true });
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'SQLITE_CANTOPEN') {
      return { error: 'Database file not found', label: 'execution_error' };
    }
    return { error: err instanceof Error ? err.message : String(err), label: 'execution_error' };
  }

  try {
    const stmt = db.prepare(query);
    const results = stmt.all();
    const json = JSON.stringify(results, null, 2);
    return trimOutput(json, ctx.maxResultBytes);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), label: 'execution_error' };
  } finally {
    try {
      db.close();
    } catch {}
  }
}

export const query_db = {
  name: 'query_db',
  description: 'Run a read-only SQL query on a SQLite database',
  schema,
  execute,
  isReadOnly: true,
};
