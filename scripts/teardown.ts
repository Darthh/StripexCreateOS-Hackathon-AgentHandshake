// npm run teardown -- --yes — destroy every Two-Key box (including forks) and both networks.
import { createos, fail, loadEnv, ok } from "./lib.ts";

if (!process.argv.includes("--yes")) fail("this destroys every sandbox on the CreateOS account. Re-run with: npm run teardown -- --yes");
const cos = createos(loadEnv());
for (const b of await cos.listSandboxes()) {
  if (["destroyed", "destroying"].includes(b.status)) continue;
  await b.destroy();
  ok(`destroyed ${b.name ?? b.id}`);
}
for (const n of await cos.networks.list()) {
  if (!n.name.startsWith("twokey-")) continue;
  await cos.networks.delete(n.id).catch((e) => console.log(`network ${n.name}: ${e.message}`));
  ok(`deleted network ${n.name}`);
}
