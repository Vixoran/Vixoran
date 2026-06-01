import { db } from '../db.js';
export async function engagementRoutes(fastify) {
  fastify.post('/engagement', async (req, reply) => {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return reply.send({ ok: false }); }
    }
    const { vid, session_id, page, total_time, engagements = [] } = body;
    const scrollDepthMax = Math.max(0,
      ...engagements.filter(e => e.type === 'scroll_depth').map(e => e.data.percent)
    );
    const timeActiveSec = engagements
      .filter(e => e.type === 'time_milestone')
      .map(e => e.data.seconds)
      .reduce((a, b) => Math.max(a, b), 0);
    const videoCompletionPct = Math.max(0,
      ...engagements.filter(e => e.type === 'video_progress').map(e => e.data.percent)
    );
    const ctaClicked = engagements.some(e => e.type === 'cta_click');
    await db.query(
      `INSERT INTO engagement_sessions (
        vid, session_id, page, total_time_ms,
        scroll_depth_max, time_active_seconds, video_completion_pct, cta_clicked, engagements
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [vid, session_id, page, total_time,
       scrollDepthMax, timeActiveSec, videoCompletionPct, ctaClicked, JSON.stringify(engagements)]
    );
    await db.query(
      `UPDATE touchpoints SET
        scroll_depth_max    = GREATEST(scroll_depth_max, $1),
        time_active_seconds = GREATEST(time_active_seconds, $2),
        video_completion_pct= GREATEST(video_completion_pct, $3),
        cta_clicked         = cta_clicked OR $4
       WHERE vid = $5
         AND touched_at = (SELECT MAX(touched_at) FROM touchpoints WHERE vid = $5)`,
      [scrollDepthMax, timeActiveSec, videoCompletionPct, ctaClicked, vid]
    );
    return reply.send({ ok: true });
  });
}
