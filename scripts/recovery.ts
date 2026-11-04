import { createBackup, restoreBackup, verifyBackup } from "../src/recovery.ts";
const [command, ...args] = process.argv.slice(2);
try {
  if (!['backup', 'verify', 'restore'].includes(command ?? "") || args.length !== (command === 'verify' ? 1 : 2)) throw new Error("Usage: node scripts/recovery.ts backup SOURCE_DB NEW_DIRECTORY | verify BACKUP_DIRECTORY | restore BACKUP_DIRECTORY NEW_DIRECTORY");
  const result = command === 'backup' ? await createBackup(args[0], args[1]) : command === 'verify' ? verifyBackup(args[0]) : restoreBackup(args[0], args[1]);
  console.log(JSON.stringify({ ok: true, command, result }, null, 2));
} catch (e) {
  console.error(JSON.stringify({ ok: false, command, error: e instanceof Error ? e.message : "Recovery operation failed" }));
  process.exitCode = 1;
}
