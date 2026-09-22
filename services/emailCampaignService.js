/**
 * Email campaigns:
 * 1) Notify all registered users when a blog/news is published
 * 2) Periodic investment attraction emails (cron/scheduler)
 */

const pool = require("../config/db");
const { sendEmail } = require("./emailService");
const {
  buildArticlePublishedEmail,
  buildInvestmentAttractEmail,
} = require("./email/templates/campaignEmails");

function contentNotifyEnabled() {
  return String(process.env.CONTENT_EMAIL_NOTIFY_ENABLED || "true").toLowerCase() !== "false";
}

function investmentEmailEnabled() {
  return String(process.env.INVESTMENT_EMAIL_ENABLED || "true").toLowerCase() !== "false";
}

function investmentIntervalMs() {
  const hours = Number(process.env.INVESTMENT_EMAIL_INTERVAL_HOURS || 168); // weekly default
  return Math.max(1, hours) * 60 * 60 * 1000;
}

function batchSize() {
  return Math.min(Math.max(Number(process.env.EMAIL_CAMPAIGN_BATCH_SIZE || 25), 1), 100);
}

function batchDelayMs() {
  return Math.max(Number(process.env.EMAIL_CAMPAIGN_BATCH_DELAY_MS || 800), 0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstNameFrom(fullName) {
  const part = String(fullName || "").trim().split(/\s+/)[0];
  return part || null;
}

async function listRegisteredUserEmails() {
  const [rows] = await pool.query(
    `SELECT id, email, full_name
     FROM users
     WHERE role = 'user'
       AND email IS NOT NULL
       AND email <> ''
       AND (staff_active IS NULL OR staff_active = 1)
     ORDER BY id ASC`
  );
  return rows;
}

/**
 * Fire-and-forget: notify users about a newly published article.
 * Deduped via articles.email_notified_at.
 */
function queueArticlePublishedNotify(article) {
  if (!contentNotifyEnabled()) {
    console.log("[CAMPAIGN] content notify disabled — skip article", article?.id);
    return;
  }
  if (!article?.id || article.status !== "published") return;

  setImmediate(() => {
    sendArticlePublishedBlast(article).catch((err) =>
      console.error("[CAMPAIGN] article blast failed:", err.message || err)
    );
  });
}

async function sendArticlePublishedBlast(article) {
  const [lock] = await pool.query(
    `UPDATE articles
     SET email_notified_at = NOW()
     WHERE id = :id AND status = 'published' AND email_notified_at IS NULL`,
    { id: article.id }
  );
  if (!lock.affectedRows) {
    console.log("[CAMPAIGN] article already notified or not published:", article.id);
    return { skipped: true };
  }

  const users = await listRegisteredUserEmails();
  let sent = 0;
  let failed = 0;
  const size = batchSize();

  for (let i = 0; i < users.length; i += size) {
    const chunk = users.slice(i, i + size);
    await Promise.all(
      chunk.map(async (user) => {
        try {
          const content = buildArticlePublishedEmail({
            firstName: firstNameFrom(user.full_name),
            article,
          });
          await sendEmail({
            to: user.email,
            subject: content.subject,
            html: content.html,
            text: content.text,
            emailType: `article_${article.type || "blog"}_published`,
          });
          sent += 1;
        } catch (e) {
          failed += 1;
          console.error("[CAMPAIGN] article mail fail:", user.id, e.message || e);
        }
      })
    );
    if (i + size < users.length && batchDelayMs()) await sleep(batchDelayMs());
  }

  await pool.query(
    `INSERT INTO email_campaign_logs
      (campaign_type, reference_type, reference_id, recipients_total, sent_count, failed_count, meta_json)
     VALUES
      ('article_published', 'article', :refId, :total, :sent, :failed, :meta)`,
    {
      refId: article.id,
      total: users.length,
      sent,
      failed,
      meta: JSON.stringify({
        type: article.type,
        heading: article.heading,
      }),
    }
  );

  console.log(
    `[CAMPAIGN] article #${article.id} (${article.type}) emailed: sent=${sent} failed=${failed} total=${users.length}`
  );
  return { sent, failed, total: users.length };
}

/** Cron backup: notify any published articles that never got an email blast. */
async function processPendingArticleNotifications() {
  if (!contentNotifyEnabled()) return { processed: 0 };

  const [rows] = await pool.query(
    `SELECT id, type, heading, description, category, status, image
     FROM articles
     WHERE status = 'published' AND email_notified_at IS NULL
     ORDER BY id ASC
     LIMIT 5`
  );

  for (const row of rows) {
    await sendArticlePublishedBlast(row);
  }
  return { processed: rows.length };
}

async function sendInvestmentAttractionCampaign() {
  if (!investmentEmailEnabled()) {
    console.log("[CAMPAIGN] investment emails disabled");
    return { skipped: true };
  }

  const users = await listRegisteredUserEmails();
  let sent = 0;
  let failed = 0;
  const size = batchSize();

  for (let i = 0; i < users.length; i += size) {
    const chunk = users.slice(i, i + size);
    await Promise.all(
      chunk.map(async (user) => {
        try {
          const content = buildInvestmentAttractEmail({
            firstName: firstNameFrom(user.full_name),
          });
          await sendEmail({
            to: user.email,
            subject: content.subject,
            html: content.html,
            text: content.text,
            emailType: "investment_attract",
          });
          sent += 1;
        } catch (e) {
          failed += 1;
          console.error("[CAMPAIGN] investment mail fail:", user.id, e.message || e);
        }
      })
    );
    if (i + size < users.length && batchDelayMs()) await sleep(batchDelayMs());
  }

  await pool.query(
    `INSERT INTO email_campaign_logs
      (campaign_type, reference_type, reference_id, recipients_total, sent_count, failed_count, meta_json)
     VALUES
      ('investment_attract', 'campaign', NULL, :total, :sent, :failed, :meta)`,
    {
      total: users.length,
      sent,
      failed,
      meta: JSON.stringify({ interval_hours: Number(process.env.INVESTMENT_EMAIL_INTERVAL_HOURS || 168) }),
    }
  );

  console.log(`[CAMPAIGN] investment attract emailed: sent=${sent} failed=${failed} total=${users.length}`);
  return { sent, failed, total: users.length };
}

let articleTimer = null;
let investmentTimer = null;

function startEmailCampaignSchedulers() {
  // Every hour: catch any published posts that missed notify
  const articleEveryMs = Math.max(Number(process.env.CONTENT_EMAIL_POLL_MINUTES || 60), 5) * 60 * 1000;
  if (articleTimer) clearInterval(articleTimer);
  processPendingArticleNotifications().catch((e) =>
    console.error("[CAMPAIGN] pending article poll failed:", e.message)
  );
  articleTimer = setInterval(() => {
    processPendingArticleNotifications().catch((e) =>
      console.error("[CAMPAIGN] pending article poll failed:", e.message)
    );
  }, articleEveryMs);

  // Investment attraction campaign on interval (default weekly)
  const investMs = investmentIntervalMs();
  if (investmentTimer) clearInterval(investmentTimer);

  const runInvest = () =>
    sendInvestmentAttractionCampaign().catch((e) =>
      console.error("[CAMPAIGN] investment campaign failed:", e.message)
    );

  // Delay first investment blast by 1 hour so boot doesn't spam immediately
  const firstDelay = Math.min(investMs, 60 * 60 * 1000);
  setTimeout(() => {
    runInvest();
    investmentTimer = setInterval(runInvest, investMs);
  }, firstDelay);

  console.log(
    `[CAMPAIGN] Schedulers started — content poll every ${articleEveryMs / 60000}m; investment every ${investMs / 3600000}h (first in ${firstDelay / 60000}m)`
  );
}

module.exports = {
  queueArticlePublishedNotify,
  sendArticlePublishedBlast,
  processPendingArticleNotifications,
  sendInvestmentAttractionCampaign,
  startEmailCampaignSchedulers,
  contentNotifyEnabled,
  investmentEmailEnabled,
};
