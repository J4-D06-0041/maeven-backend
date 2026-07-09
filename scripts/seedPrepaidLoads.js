const { connectWithRetry, closePool, pool } = require('../src/db');
const { createSchema } = require('../src/db/initSchema');

const SOURCE_SMART = 'https://smart.com.ph/prepaid/load';
const SOURCE_DITO = 'https://dito.ph/prepaid';

const products = [
  // Smart regular load (also marked available for TNT on Smart source page)
  { carrier: 'smart', product_code: 'SMART_REG_50', product_name: 'Smart Regular Load 50', load_type: 'regular', face_value: 50, validity_days: 365, source_url: SOURCE_SMART },
  { carrier: 'smart', product_code: 'SMART_REG_75', product_name: 'Smart Regular Load 75', load_type: 'regular', face_value: 75, validity_days: 365, source_url: SOURCE_SMART },
  { carrier: 'smart', product_code: 'SMART_REG_100', product_name: 'Smart Regular Load 100', load_type: 'regular', face_value: 100, validity_days: 365, source_url: SOURCE_SMART },
  { carrier: 'smart', product_code: 'SMART_REG_200', product_name: 'Smart Regular Load 200', load_type: 'regular', face_value: 200, validity_days: 365, source_url: SOURCE_SMART },
  { carrier: 'smart', product_code: 'SMART_REG_300', product_name: 'Smart Regular Load 300', load_type: 'regular', face_value: 300, validity_days: 365, source_url: SOURCE_SMART },
  { carrier: 'smart', product_code: 'SMART_REG_500', product_name: 'Smart Regular Load 500', load_type: 'regular', face_value: 500, validity_days: 365, source_url: SOURCE_SMART },
  { carrier: 'smart', product_code: 'SMART_REG_1000', product_name: 'Smart Regular Load 1000', load_type: 'regular', face_value: 1000, validity_days: 365, source_url: SOURCE_SMART },

  // Smart promo load
  { carrier: 'smart', product_code: 'SMART_PROMO_200P22', product_name: 'Smart Promo Load 200 + 22', load_type: 'promo', face_value: 200, validity_days: 30, source_url: SOURCE_SMART },
  { carrier: 'smart', product_code: 'SMART_PROMO_300P33', product_name: 'Smart Promo Load 300 + 33', load_type: 'promo', face_value: 300, validity_days: 30, source_url: SOURCE_SMART },
  { carrier: 'smart', product_code: 'SMART_PROMO_500P55', product_name: 'Smart Promo Load 500 + 55', load_type: 'promo', face_value: 500, validity_days: 30, source_url: SOURCE_SMART },
  { carrier: 'smart', product_code: 'SMART_PROMO_1000P150', product_name: 'Smart Promo Load 1000 + 150', load_type: 'promo', face_value: 1000, validity_days: 60, source_url: SOURCE_SMART },

  // TNT regular load (Smart source states regular load is available to TNT)
  { carrier: 'tnt', product_code: 'TNT_REG_50', product_name: 'TNT Regular Load 50', load_type: 'regular', face_value: 50, validity_days: 365, source_url: SOURCE_SMART },
  { carrier: 'tnt', product_code: 'TNT_REG_75', product_name: 'TNT Regular Load 75', load_type: 'regular', face_value: 75, validity_days: 365, source_url: SOURCE_SMART },
  { carrier: 'tnt', product_code: 'TNT_REG_100', product_name: 'TNT Regular Load 100', load_type: 'regular', face_value: 100, validity_days: 365, source_url: SOURCE_SMART },
  { carrier: 'tnt', product_code: 'TNT_REG_200', product_name: 'TNT Regular Load 200', load_type: 'regular', face_value: 200, validity_days: 365, source_url: SOURCE_SMART },
  { carrier: 'tnt', product_code: 'TNT_REG_300', product_name: 'TNT Regular Load 300', load_type: 'regular', face_value: 300, validity_days: 365, source_url: SOURCE_SMART },
  { carrier: 'tnt', product_code: 'TNT_REG_500', product_name: 'TNT Regular Load 500', load_type: 'regular', face_value: 500, validity_days: 365, source_url: SOURCE_SMART },
  { carrier: 'tnt', product_code: 'TNT_REG_1000', product_name: 'TNT Regular Load 1000', load_type: 'regular', face_value: 1000, validity_days: 365, source_url: SOURCE_SMART },

  // DITO offers captured from public prepaid page
  { carrier: 'dito', product_code: 'DITO_LEVELUP_99_15D', product_name: 'DITO NEW LEVEL-UP 99', load_type: 'promo', face_value: 99, validity_days: 15, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_LEVELUP_99_30D', product_name: 'DITO LEVEL-UP 99', load_type: 'promo', face_value: 99, validity_days: 30, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_LEVELUP_109', product_name: 'DITO LEVEL-UP 109', load_type: 'promo', face_value: 109, validity_days: 30, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_LEVELUP_129', product_name: 'DITO LEVEL-UP 129', load_type: 'promo', face_value: 129, validity_days: 30, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_LEVELUP_169', product_name: 'DITO LEVEL-UP 169', load_type: 'promo', face_value: 169, validity_days: 30, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_LEVELUP_199', product_name: 'DITO LEVEL-UP 199', load_type: 'promo', face_value: 199, validity_days: 30, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_LEVELUP_299', product_name: 'DITO LEVEL-UP 299', load_type: 'promo', face_value: 299, validity_days: 30, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_LEVELUP_499', product_name: 'DITO LEVEL-UP 499', load_type: 'promo', face_value: 499, validity_days: 30, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_LEVELUP_999', product_name: 'DITO LEVEL-UP 999', load_type: 'promo', face_value: 999, validity_days: 30, source_url: SOURCE_DITO },

  { carrier: 'dito', product_code: 'DITO_SOCIALS_20', product_name: 'DITO LEVEL-UP SOCIALS 20', load_type: 'data', face_value: 20, validity_days: 1, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_SOCIALS_50', product_name: 'DITO LEVEL-UP SOCIALS 50', load_type: 'data', face_value: 50, validity_days: 3, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_SOCIALS_70', product_name: 'DITO LEVEL-UP SOCIALS 70', load_type: 'data', face_value: 70, validity_days: 7, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_SOCIALS_299', product_name: 'DITO LEVEL-UP SOCIALS 299', load_type: 'data', face_value: 299, validity_days: 30, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_SOCIALS_399', product_name: 'DITO LEVEL-UP SOCIALS 399', load_type: 'data', face_value: 399, validity_days: 30, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_SOCIALS_499', product_name: 'DITO LEVEL-UP SOCIALS 499', load_type: 'data', face_value: 499, validity_days: 30, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_SOCIALS_599', product_name: 'DITO LEVEL-UP SOCIALS 599', load_type: 'data', face_value: 599, validity_days: 30, source_url: SOURCE_DITO },

  { carrier: 'dito', product_code: 'DITO_DATA_10', product_name: 'DITO DATA 10', load_type: 'data', face_value: 10, validity_days: 1, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_DATA_20', product_name: 'DITO DATA 20', load_type: 'data', face_value: 20, validity_days: 1, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_DATA_30', product_name: 'DITO DATA 30', load_type: 'data', face_value: 30, validity_days: 3, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_DATA_50', product_name: 'DITO DATA 50', load_type: 'data', face_value: 50, validity_days: 7, source_url: SOURCE_DITO },

  { carrier: 'dito', product_code: 'DITO_UNLI5G_299', product_name: 'DITO UNLI 5G 299', load_type: 'unli', face_value: 299, validity_days: 7, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_UNLI5G_499', product_name: 'DITO UNLI 5G 499', load_type: 'unli', face_value: 499, validity_days: 15, source_url: SOURCE_DITO },
  { carrier: 'dito', product_code: 'DITO_UNLI5G_999', product_name: 'DITO UNLI 5G 999', load_type: 'unli', face_value: 999, validity_days: 30, source_url: SOURCE_DITO },
];

async function seed() {
  await connectWithRetry({ retries: 5, initialDelay: 1000 });
  await createSchema();

  const sql = `
    INSERT INTO prepaid_load_products (
      carrier,
      product_code,
      product_name,
      load_type,
      face_value,
      markup_amount,
      validity_days,
      is_active,
      source_url,
      updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,now()
    )
    ON CONFLICT (product_code)
    DO UPDATE SET
      carrier = EXCLUDED.carrier,
      product_name = EXCLUDED.product_name,
      load_type = EXCLUDED.load_type,
      face_value = EXCLUDED.face_value,
      validity_days = EXCLUDED.validity_days,
      source_url = EXCLUDED.source_url,
      updated_at = now()
    RETURNING id, product_code
  `;

  let upserted = 0;
  for (const item of products) {
    await pool.query(sql, [
      item.carrier,
      item.product_code,
      item.product_name,
      item.load_type || 'regular',
      Number(item.face_value),
      0,
      item.validity_days || null,
      true,
      item.source_url || null,
    ]);
    upserted += 1;
  }

  console.log(`Seeded prepaid load catalog entries: ${upserted}`);
}

(async () => {
  try {
    await seed();
    await closePool();
    process.exit(0);
  } catch (err) {
    console.error('Prepaid load seeding failed:', err.message || err);
    try { await closePool(); } catch (e) {}
    process.exit(1);
  }
})();
