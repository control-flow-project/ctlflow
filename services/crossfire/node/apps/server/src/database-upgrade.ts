import Database from 'better-sqlite3';
import { chmodSync, existsSync, lstatSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDir } from '@ctlflow/crossfire-adapter-filesystem/index';
import { validateSchema } from '@ctlflow/crossfire-adapter-sqlite/schema/validate-schema';
import { databaseIdentity, databaseValid } from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';

export type UpgradePorts = {
  stopWriters(): Promise<void>;
  backup(): Promise<void>;
  migrate(): Promise<void>;
};

export async function prepareDatabaseUpgrade(ports: UpgradePorts): Promise<void> {
  await ports.stopWriters();
  await ports.backup();
  await ports.migrate();
}

function verify(database: Database.Database): void {
  if (databaseIdentity(database).application !== 1129465426 || !databaseValid(database))
    throw new Error('Management backup integrity or preserved relationships failed; migration is blocked');
}

export async function backupBeforeMigration(directory: string): Promise<string | null> {
  const path = join(directory, 'management.sqlite');
  if (!existsSync(path)) return null;
  const information = lstatSync(path);
  if (!information.isFile() || information.uid !== process.getuid!() || information.mode & 0o077 || realpathSync(path) !== resolve(path))
    throw new Error('Management storage must be a private owned non-symlink file');
  const database = new Database(path, { readonly: true, fileMustExist: true });
  let backup: string | undefined;
  try {
    validateSchema(database);
    verify(database);
    const parent = privateDir(join(directory, 'backups'));
    backup = join(parent, 'management-' + randomUUID() + '.sqlite');
    await database.backup(backup);
    chmodSync(backup, 0o600);
    const copy = new Database(backup, { readonly: true, fileMustExist: true });
    try {
      verify(copy);
      if (databaseIdentity(copy).version !== databaseIdentity(database).version)
        throw new Error('Management backup schema identity differs; migration is blocked');
    } finally { copy.close(); }
    return backup;
  } catch (error) { if (backup) rmSync(backup, { force: true }); throw error; }
  finally { database.close(); }
}
