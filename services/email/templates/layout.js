const path = require("path");
const fs = require("fs");
const { getEmailConfig } = require("../emailConfig");
const { resolveUploadsDir } = require("../../../config/uploadsPath");

/** Fixed email canvas (matches uploads/background-image.png aspect 1024×1536). */
const EMAIL_WIDTH = 600;
const EMAIL_HEIGHT = 900;

const LOGO_CID = "moneytrend-logo";
const LOGO_FILENAME = "money-trend-logo.png";
const BG_CID = "moneytrend-bg";
const BG_FILENAME = "background-image.png";

  /** Vertical zones scaled to EMAIL_HEIGHT (tuned to background-image.png). */
const ZONE = {
  header: 178,
  content: 332,
  features: 188,
  footer: 202,
};

const BRAND = {
  green: "#052E22",
  greenMid: "#0A3D2E",
  /** Solid header band — lighter so logo wordmark stays readable */
  headerBg: "#F4EFE3",
  gold: "#C4A45A",
  goldSoft: "#D4B978",
  cream: "#FEFAF2",
  white: "#FFFFFF",
  text: "#1A2E24",
  muted: "#5C6B63",
};

const SOCIAL = {
  facebook: "https://www.facebook.com/moneytrendofficials",
  instagram: "https://www.instagram.com/moneytrendinc?utm_source=qr&igsi=eGxrZjRydjJiM3pp",
  x: "https://x.com/MoneytrendInc",
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveUploadFile(filename) {
  const uploads = resolveUploadsDir();
  const candidates = [
    path.join(uploads, filename),
    path.join(process.cwd(), "uploads", filename),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function readInlineAttachment(filename, cid) {
  const filePath = resolveUploadFile(filename);
  if (!filePath) return null;
  let content;
  try {
    content = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  return {
    filename,
    content,
    cid,
    contentType: "image/png",
    contentDisposition: "inline",
  };
}

function getLogoSources() {
  const filePath = resolveUploadFile(LOGO_FILENAME);
  const remoteUrl = getEmailConfig().logoUrl || "";
  return {
    filePath,
    cid: LOGO_CID,
    htmlSrc: filePath ? `cid:${LOGO_CID}` : remoteUrl || "",
    remoteUrl,
  };
}

function getBackgroundSources() {
  const cfg = getEmailConfig();
  const filePath = resolveUploadFile(BG_FILENAME);
  const remote =
    String(process.env.MAIL_BG_URL || "").trim() ||
    (cfg.publicBaseUrl
      ? `${cfg.publicBaseUrl}/uploads/${BG_FILENAME}`
      : "");
  // Gmail prefers https backgrounds; Apple Mail / Outlook work well with CID.
  const cssUrl = remote || (filePath ? `cid:${BG_CID}` : "");
  return {
    filePath,
    cid: BG_CID,
    htmlSrc: filePath ? `cid:${BG_CID}` : remote || "",
    cssUrl,
    remoteUrl: remote,
  };
}

function buildLogoAttachment() {
  return readInlineAttachment(LOGO_FILENAME, LOGO_CID);
}

function buildBackgroundAttachment() {
  return readInlineAttachment(BG_FILENAME, BG_CID);
}

function buildBrandAttachments() {
  return [buildLogoAttachment(), buildBackgroundAttachment()].filter(Boolean);
}

function siteBaseUrl() {
  const cfg = getEmailConfig();
  return (
    cfg.publicBaseUrl ||
    String(process.env.FRONTEND_ORIGIN || process.env.CLIENT_ORIGIN || "https://moneytrend.in")
      .split(",")[0]
      .trim()
      .replace(/\/+$/, "") ||
    "https://moneytrend.in"
  );
}

function loginUrl() {
  return `${siteBaseUrl()}/login`;
}

function supportEmail() {
  return getEmailConfig().supportEmail || "info@moneytrend.in";
}

function renderLogoImg(width = 150) {
  const logo = getLogoSources();
  if (!logo.htmlSrc) {
    return `
      <table role="presentation" cellspacing="0" cellpadding="0">
        <tr>
          <td align="center" style="width:44px;height:44px;border-radius:50%;background:${BRAND.gold};color:${BRAND.green};font-family:Georgia,serif;font-size:18px;font-weight:700;line-height:44px;text-align:center;">
            M
          </td>
        </tr>
      </table>`;
  }
  return `<img src="${escapeHtml(logo.htmlSrc)}" alt="Money Trend" width="${width}" style="display:block;width:${width}px;max-width:${width}px;height:auto;border:0;outline:none;background:${BRAND.headerBg};" />`;
}

/**
 * Header matches brand banner:
 * [ Logo ] | [ centered Nav + slogan ] | [ chart space ]
 * Cream band so dark logo wordmark remains visible.
 */
function renderHeaderZone(base) {
  const pipe = `<span style="color:${BRAND.gold};padding:0 7px;">|</span>`;
  const link = (href, label) =>
    `<a href="${href}" style="color:${BRAND.green};text-decoration:none;font-size:11px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;">${label}</a>`;

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:${BRAND.headerBg};">
      <tr>
        <!-- Left: emblem / logo -->
        <td width="22%" align="left" valign="middle" style="width:22%;padding:10px 6px 10px 4px;">
          ${renderLogoImg(72)}
        </td>
        <!-- Center: nav + slogan as one centered block -->
        <td width="56%" align="center" valign="middle" style="width:56%;padding:12px 4px;">
          <table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto;border-collapse:collapse;">
            <tr>
              <td align="center" style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:1.4;white-space:nowrap;color:${BRAND.green};">
                ${link(`${base}/fd`, "FD")}
                ${pipe}
                ${link(`${base}/rd`, "RD")}
                ${pipe}
                ${link(`${base}/mutual-funds`, "MUTUAL FUNDS")}
                ${pipe}
                ${link(`${base}/credit-check`, "CREDIT CHECK")}
                ${pipe}
                ${link(`${base}/`, "MORE")}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:9px;font-family:Georgia,'Times New Roman',Times,serif;font-size:14px;line-height:1.35;color:${BRAND.gold};font-weight:600;">
                Smart Tools for a Brighter Tomorrow
              </td>
            </tr>
          </table>
        </td>
        <!-- Right: space for growth chart -->
        <td width="22%" align="right" valign="middle" style="width:22%;padding:10px 4px;">&nbsp;</td>
      </tr>
      <!-- Gold divider under header (matches banner) -->
      <tr>
        <td colspan="3" style="height:2px;line-height:2px;font-size:0;background:${BRAND.gold};">&nbsp;</td>
      </tr>
    </table>
  `;
}

function renderSocialLinks({ light = true } = {}) {
  const color = light ? BRAND.goldSoft : BRAND.green;
  return `
    <a href="${SOCIAL.facebook}" target="_blank" rel="noopener noreferrer" style="color:${color};text-decoration:none;font-size:12px;font-weight:600;padding:0 8px;">Facebook</a>
    <span style="color:${BRAND.gold};">·</span>
    <a href="${SOCIAL.instagram}" target="_blank" rel="noopener noreferrer" style="color:${color};text-decoration:none;font-size:12px;font-weight:600;padding:0 8px;">Instagram</a>
    <span style="color:${BRAND.gold};">·</span>
    <a href="${SOCIAL.x}" target="_blank" rel="noopener noreferrer" style="color:${color};text-decoration:none;font-size:12px;font-weight:600;padding:0 8px;">X</a>
  `;
}

/**
 * Feature captions that sit under the 4 icons already drawn in background-image.png.
 */
function renderFeatureCaptions() {
  const cell = (title, line) => `
    <td width="25%" valign="top" style="padding:6px 6px 0;text-align:center;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
      <div style="font-size:12px;font-weight:700;color:${BRAND.green};margin-bottom:4px;">${title}</div>
      <div style="font-size:10px;line-height:1.4;color:${BRAND.muted};">${line}</div>
    </td>`;
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        ${cell("Invest Smart", "FDs, RDs &amp; Mutual Funds")}
        ${cell("Credit Score", "Instant credit report")}
        ${cell("Plan Goals", "Calculators &amp; tools")}
        ${cell("Stay Informed", "News &amp; insights")}
      </tr>
    </table>
  `;
}

/**
 * Industry artboard layout: ONLY background-image.png as the visual.
 * Content is overlaid in measured zones (header / body / features / footer).
 */
function renderEmailLayout({ title, preheader, bodyHtml, showFeatureCaptions = true }) {
  const bg = getBackgroundSources();
  const bgSrc = bg.cssUrl || bg.htmlSrc;
  const support = escapeHtml(supportEmail());
  const year = new Date().getFullYear();
  const base = siteBaseUrl();

  const bgAttr = bgSrc ? ` background="${escapeHtml(bgSrc)}"` : "";
  const bgCss = bgSrc
    ? `background-image:url('${escapeHtml(bgSrc)}');background-repeat:no-repeat;background-position:center top;background-size:${EMAIL_WIDTH}px ${EMAIL_HEIGHT}px;`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(title)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#F3EEE4;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader || "")}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F3EEE4;padding:24px 0;">
    <tr>
      <td align="center" style="padding:0 12px;">
        <!--[if mso]>
        <table role="presentation" width="${EMAIL_WIDTH}" cellspacing="0" cellpadding="0"><tr><td>
        <![endif]-->
        <table role="presentation" width="${EMAIL_WIDTH}" cellspacing="0" cellpadding="0" style="width:100%;max-width:${EMAIL_WIDTH}px;border-collapse:collapse;">
          <tr>
            <td${bgAttr} bgcolor="${BRAND.cream}" width="${EMAIL_WIDTH}" height="${EMAIL_HEIGHT}" valign="top"
                style="${bgCss}background-color:${BRAND.cream};width:${EMAIL_WIDTH}px;height:${EMAIL_HEIGHT}px;">
              <!--[if gte mso 9]>
              <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${EMAIL_WIDTH}px;height:${EMAIL_HEIGHT}px;">
                <v:fill type="frame" src="${escapeHtml(bgSrc || "")}" color="${BRAND.cream}" />
                <v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text:true">
              <![endif]-->
              <div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <!-- HEADER ZONE — cream band, centered nav block, gold rule -->
                  <tr>
                    <td height="${ZONE.header}" valign="middle" bgcolor="${BRAND.headerBg}" style="height:${ZONE.header}px;padding:0;background-color:${BRAND.headerBg};">
                      ${renderHeaderZone(base)}
                    </td>
                  </tr>

                  <!-- CONTENT ZONE (white artboard) -->
                  <tr>
                    <td height="${ZONE.content}" valign="top" style="height:${ZONE.content}px;padding:8px 36px 0;font-family:Georgia,'Times New Roman',Times,serif;">
                      ${bodyHtml}
                    </td>
                  </tr>

                  <!-- FEATURE CAPTIONS (icons already in background-image.png) -->
                  <tr>
                    <td height="${ZONE.features}" valign="bottom" style="height:${ZONE.features}px;padding:78px 20px 10px;">
                      ${showFeatureCaptions ? renderFeatureCaptions() : "&nbsp;"}
                    </td>
                  </tr>

                  <!-- FOOTER ZONE -->
                  <tr>
                    <td height="${ZONE.footer}" valign="middle" style="height:${ZONE.footer}px;padding:18px 28px 22px;text-align:center;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
                      <div style="font-size:12px;line-height:1.5;color:#E8F0EC;margin-bottom:8px;">
                        Have questions? We typically respond within 24 hours.
                      </div>
                      <div style="margin-bottom:10px;">
                        <a href="mailto:${support}" style="color:${BRAND.gold};text-decoration:none;font-size:14px;font-weight:700;">${support}</a>
                      </div>
                      <div style="margin-bottom:12px;">${renderSocialLinks({ light: true })}</div>
                      <div style="font-size:11px;color:#9BB5A8;">© ${year} Money Trend. All rights reserved.</div>
                    </td>
                  </tr>
                </table>
              </div>
              <!--[if gte mso 9]>
                </v:textbox>
              </v:rect>
              <![endif]-->
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = {
  BRAND,
  SOCIAL,
  LOGO_CID,
  BG_CID,
  EMAIL_WIDTH,
  EMAIL_HEIGHT,
  ZONE,
  escapeHtml,
  renderEmailLayout,
  getLogoSources,
  getBackgroundSources,
  buildLogoAttachment,
  buildBackgroundAttachment,
  buildBrandAttachments,
  siteBaseUrl,
  loginUrl,
  supportEmail,
};
