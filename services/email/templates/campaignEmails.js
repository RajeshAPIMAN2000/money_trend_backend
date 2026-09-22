const { getEmailConfig } = require("../emailConfig");
const { BRAND, escapeHtml, renderEmailLayout } = require("./layout");

function siteBase() {
  return String(
    process.env.FRONTEND_ORIGIN ||
      process.env.CLIENT_ORIGIN ||
      process.env.PUBLIC_SITE_URL ||
      "https://moneytrend.in"
  )
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");
}

function buildArticlePublishedEmail({ firstName, article }) {
  const cfg = getEmailConfig();
  const name = escapeHtml(firstName || "there");
  const typeLabel = article.type === "news" ? "News" : "Blog";
  const heading = escapeHtml(article.heading || `${typeLabel} update`);
  const excerpt = escapeHtml(
    String(article.description || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220)
  );
  const base = siteBase();
  const path =
    article.type === "news"
      ? `${base}/news/${article.id}`
      : `${base}/blogs/${article.id}`;
  const category = article.category ? escapeHtml(article.category) : null;

  const bodyHtml = `
    <p style="margin:0 0 8px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:${BRAND.green};">
      Hello ${name},
    </p>
    <h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',Times,serif;font-size:22px;line-height:1.3;color:${BRAND.green};">
      New ${escapeHtml(typeLabel)} on Money Trend
    </h1>
    <p style="margin:0 0 14px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.text};">
      We just published a fresh ${escapeHtml(typeLabel.toLowerCase())} for you.
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 16px;background:rgba(255,255,255,0.94);border:1px solid #E6D7B0;border-radius:12px;">
      <tr>
        <td style="padding:16px;">
          ${
            category
              ? `<div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.gold};margin-bottom:8px;">${category}</div>`
              : ""
          }
          <div style="font-family:Georgia,serif;font-size:18px;color:${BRAND.green};margin-bottom:8px;">${heading}</div>
          <p style="margin:0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;color:${BRAND.muted};">
            ${excerpt}${excerpt.length >= 220 ? "…" : ""}
          </p>
        </td>
      </tr>
    </table>
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 12px;">
      <tr>
        <td style="background:${BRAND.green};border-radius:8px;">
          <a href="${escapeHtml(path)}" style="display:inline-block;padding:12px 18px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;color:#fff;text-decoration:none;">
            Read ${escapeHtml(typeLabel)}
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.muted};">
      You are receiving this because you have a Money Trend account.
    </p>
  `;

  return {
    subject: `New ${typeLabel}: ${String(article.heading || "").slice(0, 80)}`,
    html: renderEmailLayout({
      title: `New ${typeLabel} | ${cfg.appName || "Money Trend"}`,
      preheader: `New ${typeLabel.toLowerCase()} published on Money Trend`,
      bodyHtml,
      showFeatureCaptions: true,
    }),
    text: [
      `Hello ${firstName || "there"},`,
      ``,
      `New ${typeLabel} on Money Trend: ${article.heading}`,
      ``,
      excerpt,
      ``,
      `Read more: ${path}`,
      ``,
      `— Money Trend`,
    ].join("\n"),
  };
}

function buildInvestmentAttractEmail({ firstName }) {
  const cfg = getEmailConfig();
  const name = escapeHtml(firstName || "there");
  const base = siteBase();
  const investUrl = `${base}/invest`;
  const fdUrl = `${base}/fd`;
  const rdUrl = `${base}/rd`;
  const walletUrl = `${base}/wallet`;

  const bodyHtml = `
    <p style="margin:0 0 8px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:${BRAND.green};">
      Hello ${name},
    </p>
    <h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',Times,serif;font-size:22px;line-height:1.3;color:${BRAND.green};">
      Grow your money with Money Trend
    </h1>
    <p style="margin:0 0 14px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.text};">
      Competitive FD &amp; RD rates are available now. Add funds to your wallet and start investing in a few taps.
    </p>
    <ul style="margin:0 0 16px;padding-left:18px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:${BRAND.text};">
      <li>Compare live bank FD / RD rates</li>
      <li>Invest securely from your Money Trend wallet</li>
      <li>Track goals, portfolio and maturity in one place</li>
    </ul>
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 10px;">
      <tr>
        <td style="background:${BRAND.green};border-radius:8px;">
          <a href="${escapeHtml(investUrl)}" style="display:inline-block;padding:12px 18px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;color:#fff;text-decoration:none;">
            Explore investments
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 4px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.muted};">
      Quick links:
      <a href="${escapeHtml(fdUrl)}" style="color:${BRAND.green};">FD</a> ·
      <a href="${escapeHtml(rdUrl)}" style="color:${BRAND.green};">RD</a> ·
      <a href="${escapeHtml(walletUrl)}" style="color:${BRAND.green};">Wallet</a>
    </p>
    <p style="margin:8px 0 0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:${BRAND.muted};">
      This is an informational email about investment opportunities on Money Trend.
    </p>
  `;

  return {
    subject: "Invest smarter with Money Trend — FD & RD opportunities",
    html: renderEmailLayout({
      title: `Invest | ${cfg.appName || "Money Trend"}`,
      preheader: "Explore FD & RD investment opportunities on Money Trend",
      bodyHtml,
      showFeatureCaptions: true,
    }),
    text: [
      `Hello ${firstName || "there"},`,
      ``,
      `Grow your money with Money Trend — explore FD & RD rates and invest from your wallet.`,
      ``,
      `Explore: ${investUrl}`,
      `FD: ${fdUrl}`,
      `RD: ${rdUrl}`,
      ``,
      `— Money Trend`,
    ].join("\n"),
  };
}

module.exports = {
  buildArticlePublishedEmail,
  buildInvestmentAttractEmail,
  siteBase,
};
