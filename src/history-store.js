import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

export function createHistoryStore(databasePath) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), {recursive: true});
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS calculations (
      id TEXT PRIMARY KEY,
      expression TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  // Add the new field in place: previous calculation records remain intact.
  const columns = database.prepare('PRAGMA table_info(calculations)').all();
  if (!columns.some((column) => column.name === 'client_info')) {
    database.exec('ALTER TABLE calculations ADD COLUMN client_info TEXT');
  }
  if (!columns.some((column) => column.name === 'owner_id')) {
    database.exec('ALTER TABLE calculations ADD COLUMN owner_id TEXT');
  }
  database.exec('CREATE INDEX IF NOT EXISTS calculations_owner_date ON calculations(owner_id, created_at DESC)');
  const insert = database.prepare('INSERT INTO calculations (id, expression, result, created_at, client_info, owner_id) VALUES (?, ?, ?, ?, ?, ?)');
  const list = database.prepare('SELECT id, expression, result, created_at AS createdAt, client_info AS clientInfo FROM calculations ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?');
  const count = database.prepare('SELECT COUNT(*) AS total FROM calculations');
  const remove = database.prepare('DELETE FROM calculations WHERE id = ?');
  const ownedList = database.prepare('SELECT id, expression, result, created_at AS createdAt, client_info AS clientInfo FROM calculations WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?');
  const ownedCount = database.prepare('SELECT COUNT(*) AS total FROM calculations WHERE owner_id = ?');
  const ownedRemove = database.prepare('DELETE FROM calculations WHERE id = ? AND owner_id = ?');
  return {
    checkHealth() { database.prepare('SELECT 1').get(); },
    save(calculation, client = null, owner = null) {
      const item = {id: randomUUID(), ...calculation, createdAt: new Date().toISOString(), client};
      insert.run(item.id, item.expression, item.result, item.createdAt, client ? JSON.stringify(client) : null, owner);
      return item;
    },
    // Unscoped access is for local administration only; HTTP routes always pass an owner.
    list(limit = 20, offset = 0, owner = null) {
      const rows = owner === null ? list.all(limit, offset) : ownedList.all(owner, limit, offset);
      const items = rows.map(({clientInfo, ...item}) => ({
        ...item, client: clientInfo ? JSON.parse(clientInfo) : null,
      }));
      return {items, total: owner === null ? count.get().total : ownedCount.get(owner).total};
    },
    remove(id, owner = null) { return (owner === null ? remove.run(id) : ownedRemove.run(id, owner)).changes > 0; },
    close() { database.close(); },
  };
}
