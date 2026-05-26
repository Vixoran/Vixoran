import { db } from '../db.js';

export async function calculateAttribution(userHash, vid, revenue, conversionDate) {
  const { rows: touchpoints } = await db.query(
    `SELECT * FROM touchpoints
     WHERE (user_hash = $1 OR vid = $2)
       AND touched_at >= $3::timestamptz - INTERVAL '30 days'
     ORDER BY touched_at ASC`,
    [userHash, vid, conversionDate]
  );

  if (touchpoints.length === 0) return { attribution: {}, touchpoints: [] };

  const credits = {};
  const total = touchpoints.length;

  touchpoints.forEach((tp, i) => {
    const channel = tp.channel || 'direct';
    if (!credits[channel]) credits[channel] = 0;

    let weight = getPositionWeight(i, total);
    weight *= getEngagementScore(tp);

    // Correção brand search: Google leva crédito indevido após Meta
    if (tp.is_brand_search && touchpoints.slice(0, i).some(t => t.channel === 'meta')) {
      const transfer = weight * 0.8;
      weight *= 0.2;
      credits['meta'] = (credits['meta'] || 0) + transfer;
    }

    credits[channel] += weight;
  });

  const totalWeight = Object.values(credits).reduce((a, b) => a + b, 0);
  const attribution = {};

  for (const [channel, w] of Object.entries(credits)) {
    const pct = totalWeight > 0 ? w / totalWeight : 0;
    attribution[channel] = {
      credit_pct: parseFloat(pct.toFixed(4)),
      revenue_attributed: parseFloat((revenue * pct).toFixed(2)),
      touchpoints: touchpoints.filter(t => t.channel === channel).length,
    };
  }

  return { attribution, touchpoints };
}

function getPositionWeight(index, total) {
  if (total === 1) return 1.0;
  if (index === 0) return 0.35;
  if (index === total - 1) return 0.35;
  return 0.30 / (total - 2);
}

function getEngagementScore(tp) {
  let score = 1.0;
  if (tp.scroll_depth_max >= 75) score += 0.3;
  else if (tp.scroll_depth_max >= 50) score += 0.15;
  if (tp.time_active_seconds >= 120) score += 0.4;
  else if (tp.time_active_seconds >= 30) score += 0.2;
  if (tp.video_completion_pct >= 75) score += 0.6;
  else if (tp.video_completion_pct >= 25) score += 0.2;
  if (tp.cta_clicked) score += 0.5;
  return score;
}
