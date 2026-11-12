import db from "../db.server";

/** Per-shop app settings (setup checklist state, ship-from choice). No secrets. */

export async function getSettings(shop: string): Promise<Record<string, string>> {
  const rows = await db.setting.findMany({ where: { shop } });
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(shop: string, key: string, value: string | null) {
  if (value === null) {
    await db.setting.deleteMany({ where: { shop, key } });
    return;
  }
  await db.setting.upsert({
    where: { shop_key: { shop, key } },
    create: { shop, key, value },
    update: { value },
  });
}
