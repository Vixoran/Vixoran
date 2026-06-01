import { db } from '../db.js';

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function safeDivide(numerator, denominator) {
  const n = toNumber(numerator);
  const d = toNumber(denominator);
  if (!d) return 0;
  return n / d;
}

export async function dashboardRoutes(fastify) {
  fastify.get('/dashboard/overview', async (req, reply) => {
    const date = req.query?.date || null;

    const result = await db.query(
      `
      SELECT
        COALESCE(SUM(spend), 0) AS spend,
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(clicks), 0) AS clicks,
        COALESCE(SUM(purchases_total), 0) AS meta_purchases_total,
        COALESCE(SUM(purchases_1d_view), 0) AS meta_purchases_view,
        COALESCE(SUM(purchases_7d_click), 0) AS meta_purchases_click,
        COALESCE(SUM(purchase_value_total), 0) AS meta_purchase_value_total,
        COALESCE(SUM(purchase_value_1d_view), 0) AS meta_purchase_value_view,
        COALESCE(SUM(purchase_value_7d_click), 0) AS meta_purchase_value_click
      FROM meta_ad_insights
      WHERE ($1::date IS NULL OR date_start = $1::date)
      `,
      [date]
    );

    const row = result.rows[0] || {};

    const spend = toNumber(row.spend);
    const impressions = toNumber(row.impressions);
    const clicks = toNumber(row.clicks);
    const metaPurchasesTotal = toNumber(row.meta_purchases_total);
    const metaPurchasesView = toNumber(row.meta_purchases_view);
    const metaPurchasesClick = toNumber(row.meta_purchases_click);
    const metaPurchaseValueTotal = toNumber(row.meta_purchase_value_total);

    return reply.send({
      ok: true,
      date,
      data: {
        spend,
        impressions,
        clicks,
        meta_purchases_total: metaPurchasesTotal,
        meta_purchases_view: metaPurchasesView,
        meta_purchases_click: metaPurchasesClick,
        meta_purchase_value_total: metaPurchaseValueTotal,
        meta_purchase_value_view: toNumber(row.meta_purchase_value_view),
        meta_purchase_value_click: toNumber(row.meta_purchase_value_click),

        ctr: safeDivide(clicks, impressions),
        cpa_total: safeDivide(spend, metaPurchasesTotal),
        cpa_view: safeDivide(spend, metaPurchasesView),
        cpa_click: safeDivide(spend, metaPurchasesClick),
        view_share: safeDivide(metaPurchasesView, metaPurchasesTotal),
        click_share: safeDivide(metaPurchasesClick, metaPurchasesTotal),
        roas_meta: safeDivide(metaPurchaseValueTotal, spend)
      }
    });
  });

  fastify.get('/dashboard/ads', async (req, reply) => {
    const date = req.query?.date || null;
    const limit = Math.min(parseInt(req.query?.limit || '100', 10), 500);

    const result = await db.query(
      `
      SELECT
        date_start,
        campaign_id,
        campaign_name,
        adset_id,
        adset_name,
        ad_id,
        ad_name,

        COALESCE(SUM(spend), 0) AS spend,
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(clicks), 0) AS clicks,

        COALESCE(SUM(purchases_total), 0) AS purchases_total,
        COALESCE(SUM(purchases_1d_view), 0) AS purchases_1d_view,
        COALESCE(SUM(purchases_7d_click), 0) AS purchases_7d_click,

        COALESCE(SUM(purchase_value_total), 0) AS purchase_value_total,
        COALESCE(SUM(purchase_value_1d_view), 0) AS purchase_value_1d_view,
        COALESCE(SUM(purchase_value_7d_click), 0) AS purchase_value_7d_click

      FROM meta_ad_insights
      WHERE ($1::date IS NULL OR date_start = $1::date)
      GROUP BY
        date_start,
        campaign_id,
        campaign_name,
        adset_id,
        adset_name,
        ad_id,
        ad_name
      ORDER BY
        SUM(purchases_1d_view) DESC,
        SUM(purchases_total) DESC,
        SUM(spend) DESC
      LIMIT $2
      `,
      [date, limit]
    );

    const data = result.rows.map(row => {
      const spend = toNumber(row.spend);
      const impressions = toNumber(row.impressions);
      const clicks = toNumber(row.clicks);
      const purchasesTotal = toNumber(row.purchases_total);
      const purchasesView = toNumber(row.purchases_1d_view);
      const purchasesClick = toNumber(row.purchases_7d_click);
      const purchaseValueTotal = toNumber(row.purchase_value_total);

      let diagnosis = 'Baixa evidência';

      if (purchasesTotal >= 2 && safeDivide(purchasesView, purchasesTotal) >= 0.7) {
        diagnosis = 'View-through forte';
      } else if (purchasesTotal >= 2 && safeDivide(purchasesClick, purchasesTotal) >= 0.7) {
        diagnosis = 'Click-through forte';
      } else if (purchasesView > 0 && purchasesClick > 0) {
        diagnosis = 'Misto';
      } else if (spend > 100 && purchasesTotal === 0) {
        diagnosis = 'Gasto sem compra';
      }

      return {
        date_start: row.date_start,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        adset_id: row.adset_id,
        adset_name: row.adset_name,
        ad_id: row.ad_id,
        ad_name: row.ad_name,

        spend,
        impressions,
        clicks,

        purchases_total: purchasesTotal,
        purchases_1d_view: purchasesView,
        purchases_7d_click: purchasesClick,

        purchase_value_total: purchaseValueTotal,
        purchase_value_1d_view: toNumber(row.purchase_value_1d_view),
        purchase_value_7d_click: toNumber(row.purchase_value_7d_click),

        ctr: safeDivide(clicks, impressions),
        cpa_total: safeDivide(spend, purchasesTotal),
        cpa_view: safeDivide(spend, purchasesView),
        cpa_click: safeDivide(spend, purchasesClick),
        view_share: safeDivide(purchasesView, purchasesTotal),
        click_share: safeDivide(purchasesClick, purchasesTotal),
        roas_meta: safeDivide(purchaseValueTotal, spend),
        diagnosis
      };
    });

    return reply.send({
      ok: true,
      date,
      count: data.length,
      data
    });
  });

  fastify.get('/dashboard/campaigns', async (req, reply) => {
    const date = req.query?.date || null;

    const result = await db.query(
      `
      SELECT
        date_start,
        campaign_id,
        campaign_name,

        COALESCE(SUM(spend), 0) AS spend,
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(clicks), 0) AS clicks,

        COALESCE(SUM(purchases_total), 0) AS purchases_total,
        COALESCE(SUM(purchases_1d_view), 0) AS purchases_1d_view,
        COALESCE(SUM(purchases_7d_click), 0) AS purchases_7d_click,

        COALESCE(SUM(purchase_value_total), 0) AS purchase_value_total

      FROM meta_ad_insights
      WHERE ($1::date IS NULL OR date_start = $1::date)
      GROUP BY
        date_start,
        campaign_id,
        campaign_name
      ORDER BY
        SUM(purchases_total) DESC,
        SUM(spend) DESC
      LIMIT 100
      `,
      [date]
    );

    const data = result.rows.map(row => {
      const spend = toNumber(row.spend);
      const impressions = toNumber(row.impressions);
      const clicks = toNumber(row.clicks);
      const purchasesTotal = toNumber(row.purchases_total);
      const purchasesView = toNumber(row.purchases_1d_view);
      const purchasesClick = toNumber(row.purchases_7d_click);
      const purchaseValueTotal = toNumber(row.purchase_value_total);

      return {
        date_start: row.date_start,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        spend,
        impressions,
        clicks,
        purchases_total: purchasesTotal,
        purchases_1d_view: purchasesView,
        purchases_7d_click: purchasesClick,
        purchase_value_total: purchaseValueTotal,
        ctr: safeDivide(clicks, impressions),
        cpa_total: safeDivide(spend, purchasesTotal),
        cpa_view: safeDivide(spend, purchasesView),
        cpa_click: safeDivide(spend, purchasesClick),
        view_share: safeDivide(purchasesView, purchasesTotal),
        roas_meta: safeDivide(purchaseValueTotal, spend)
      };
    });

    return reply.send({
      ok: true,
      date,
      count: data.length,
      data
    });
  });
}