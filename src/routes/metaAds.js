import { db } from '../db.js';

function toInt(value) {
  const n = parseInt(value || '0', 10);
  return Number.isFinite(n) ? n : 0;
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function findAction(actions = [], names = []) {
  return actions.find(a => names.includes(a.action_type)) || null;
}

function extractPurchaseStats(row) {
  const purchaseAction = findAction(row.actions || [], [
    'purchase',
    'offsite_conversion.fb_pixel_purchase',
    'omni_purchase',
    'web_in_store_purchase',
    'onsite_web_purchase',
    'onsite_web_app_purchase',
    'web_app_in_store_purchase',
    'offsite_purchase_add_20_s_calls'
  ]);

  const purchaseValueAction = findAction(row.action_values || [], [
    'purchase',
    'offsite_conversion.fb_pixel_purchase',
    'omni_purchase',
    'web_in_store_purchase',
    'onsite_web_purchase',
    'onsite_web_app_purchase',
    'web_app_in_store_purchase',
    'offsite_purchase_add_20_s_calls'
  ]);

  return {
    purchases_total: toInt(purchaseAction?.value),
    purchases_1d_view: toInt(purchaseAction?.['1d_view']),
    purchases_7d_click: toInt(purchaseAction?.['7d_click']),

    purchase_value_total: toNumber(purchaseValueAction?.value),
    purchase_value_1d_view: toNumber(purchaseValueAction?.['1d_view']),
    purchase_value_7d_click: toNumber(purchaseValueAction?.['7d_click'])
  };
}

async function fetchAllMetaInsights({ datePreset = 'today' }) {
  const token = process.env.META_ADS_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  if (!token) {
    throw new Error('META_ADS_ACCESS_TOKEN não configurado');
  }

  if (!adAccountId) {
    throw new Error('META_AD_ACCOUNT_ID não configurado');
  }

  const params = new URLSearchParams({
    level: 'ad',
    fields: [
      'campaign_id',
      'campaign_name',
      'adset_id',
      'adset_name',
      'ad_id',
      'ad_name',
      'impressions',
      'spend',
      'clicks',
      'actions',
      'action_values'
    ].join(','),
    action_attribution_windows: '["1d_view","7d_click"]',
    date_preset: datePreset,
    limit: '100',
    access_token: token
  });

  let url = `https://graph.facebook.com/v20.0/${adAccountId}/insights?${params.toString()}`;
  const rows = [];

  while (url) {
    const response = await fetch(url);
    const json = await response.json();

    if (!response.ok || json.error) {
      throw new Error(JSON.stringify(json.error || json));
    }

    rows.push(...(json.data || []));
    url = json.paging?.next || null;
  }

  return rows;
}

export async function metaAdsRoutes(fastify) {
  fastify.post('/meta/sync-ads', async (req, reply) => {
    try {
      const datePreset = req.body?.date_preset || 'today';
      const rows = await fetchAllMetaInsights({ datePreset });

      if (rows.length === 0) {
        return reply.send({
          ok: true,
          date_preset: datePreset,
          rows_received: 0,
          rows_deleted: 0,
          rows_inserted: 0
        });
      }

      const dates = [...new Set(rows.map(row => row.date_start).filter(Boolean))];

      let deleted = 0;

      for (const date of dates) {
        const deleteResult = await db.query(
          `DELETE FROM meta_ad_insights
           WHERE date_start = $1`,
          [date]
        );

        deleted += deleteResult.rowCount || 0;
      }

      let inserted = 0;

      for (const row of rows) {
        const stats = extractPurchaseStats(row);

        await db.query(
          `INSERT INTO meta_ad_insights (
            date_start,
            date_stop,

            campaign_id,
            campaign_name,
            adset_id,
            adset_name,
            ad_id,
            ad_name,

            impressions,
            spend,
            clicks,

            purchases_total,
            purchases_1d_view,
            purchases_7d_click,

            purchase_value_total,
            purchase_value_1d_view,
            purchase_value_7d_click,

            raw_payload
          ) VALUES (
            $1,$2,
            $3,$4,$5,$6,$7,$8,
            $9,$10,$11,
            $12,$13,$14,
            $15,$16,$17,
            $18
          )`,
          [
            row.date_start,
            row.date_stop,

            row.campaign_id || null,
            row.campaign_name || null,
            row.adset_id || null,
            row.adset_name || null,
            row.ad_id || null,
            row.ad_name || null,

            toInt(row.impressions),
            toNumber(row.spend),
            toInt(row.clicks),

            stats.purchases_total,
            stats.purchases_1d_view,
            stats.purchases_7d_click,

            stats.purchase_value_total,
            stats.purchase_value_1d_view,
            stats.purchase_value_7d_click,

            JSON.stringify(row)
          ]
        );

        inserted++;
      }

      return reply.send({
        ok: true,
        date_preset: datePreset,
        dates_synced: dates,
        rows_received: rows.length,
        rows_deleted: deleted,
        rows_inserted: inserted
      });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({
        ok: false,
        error: err.message
      });
    }
  });

  fastify.get('/meta/insights-summary', async (req, reply) => {
    const result = await db.query(
      `SELECT
        date_start,
        COUNT(*) AS ads,
        SUM(spend) AS spend,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(purchases_total) AS purchases_total,
        SUM(purchases_1d_view) AS purchases_1d_view,
        SUM(purchases_7d_click) AS purchases_7d_click
      FROM meta_ad_insights
      GROUP BY date_start
      ORDER BY date_start DESC
      LIMIT 30`
    );

    return reply.send({
      ok: true,
      data: result.rows
    });
  });
}
