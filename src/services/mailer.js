const nodemailer = require('nodemailer');
const { appBaseUrl, platformName } = require('../config/platform');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildVerificationEmail(user, verifyUrl) {
  const safeName = escapeHtml(user.name || 'there');
  const safePlatform = escapeHtml(platformName);
  const safeUrl = escapeHtml(verifyUrl);

  const text = [
    `Hello ${user.name || 'there'},`,
    '',
    `Verify your ${platformName} account by visiting:`,
    verifyUrl,
    '',
    'This verification link helps protect your account and confirms you own this email address.',
    '',
    'If you did not create this account, you can ignore this message.'
  ].join('\n');

  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${safePlatform} Email Verification</title>
      </head>
      <body style="margin:0;padding:0;background-color:#050706;font-family:Arial,sans-serif;color:#e8f7ec;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:radial-gradient(circle at top left, rgba(125,220,91,0.16), transparent 28%), linear-gradient(180deg, #050706 0%, #020403 100%);padding:32px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;background-color:#0b120e;border:1px solid #1f2b24;border-radius:24px;overflow:hidden;">
                <tr>
                  <td style="padding:32px 32px 20px 32px;background:linear-gradient(135deg, rgba(125,220,91,0.18), rgba(30,142,87,0.08));">
                    <div style="font-size:12px;letter-spacing:0.28em;text-transform:uppercase;color:#7ddc5b;font-weight:700;">Email Verification</div>
                    <div style="margin-top:14px;font-size:34px;line-height:1.15;font-weight:700;color:#ffffff;">Welcome to ${safePlatform}</div>
                    <div style="margin-top:12px;font-size:16px;line-height:1.6;color:#b7c8bb;">
                      Hello ${safeName}, verify your email address to activate your account and access your dashboard.
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px 32px 32px 32px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#0f1712;border:1px solid #233128;border-radius:18px;">
                      <tr>
                        <td style="padding:22px 24px;">
                          <div style="font-size:15px;line-height:1.7;color:#c7d5ca;">
                            This verification link confirms that you control this email address and helps keep merchant account access secure.
                          </div>
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
                            <tr>
                              <td align="center" bgcolor="#7ddc5b" style="border-radius:999px;">
                                <a href="${safeUrl}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:700;color:#081008;text-decoration:none;">Verify Email Address</a>
                              </td>
                            </tr>
                          </table>
                          <div style="margin-top:24px;font-size:13px;line-height:1.7;color:#8ba193;">
                            If the button does not work, copy and paste this link into your browser:
                          </div>
                          <div style="margin-top:10px;padding:14px 16px;background-color:#081008;border:1px solid #1b2820;border-radius:14px;word-break:break-all;font-size:13px;line-height:1.7;color:#d8e8dc;">
                            ${safeUrl}
                          </div>
                        </td>
                      </tr>
                    </table>
                    <div style="margin-top:22px;font-size:13px;line-height:1.7;color:#7f9386;">
                      If you did not create this account, you can safely ignore this message.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return { text, html };
}

async function getTransport() {
  if (!process.env.SMTP_HOST) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      : undefined
  });
}

async function sendVerificationEmail(user, token) {
  const verifyUrl = `${appBaseUrl}/verify?token=${encodeURIComponent(token)}`;
  const transport = await getTransport();
  const subject = `${platformName} email verification`;
  const { text, html } = buildVerificationEmail(user, verifyUrl);

  if (!transport) {
    console.log(`Verification email for ${user.email}: ${verifyUrl}`);
    return {
      delivered: false,
      previewUrl: verifyUrl
    };
  }

  await transport.sendMail({
    from: process.env.MAIL_FROM || `no-reply@${new URL(appBaseUrl).hostname}`,
    to: user.email,
    subject,
    text,
    html
  });

  return {
    delivered: true,
    previewUrl: verifyUrl
  };
}

module.exports = {
  sendVerificationEmail
};
