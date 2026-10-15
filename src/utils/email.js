// Sends email through Brevo's HTTPS API.
// Render's free web services block SMTP ports (25, 465, 587), so Gmail or any
// other SMTP service cannot be used from the free backend. HTTPS is not blocked.

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.MAIL_FROM_EMAIL;
  const fromName = process.env.MAIL_FROM_NAME || "Subway";

  if (!apiKey || !fromEmail) {
    throw new Error("Email is not configured (BREVO_API_KEY and MAIL_FROM_EMAIL are required).");
  }

  const response = await fetch(BREVO_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error("Brevo responded " + response.status + ": " + body.slice(0, 200));
  }
}

async function sendPasswordResetEmail({ to, name, link }) {
  const hello = name ? "Hi " + escapeHtml(name) + "," : "Hi,";
  const safeLink = escapeHtml(link);

  await sendEmail({
    to,
    subject: "Reset your Subway password",
    text:
      (name ? "Hi " + name + ",\n\n" : "Hi,\n\n") +
      "We received a request to reset your Subway password. Open this link to choose a new one:\n\n" +
      link +
      "\n\nThe link works once and expires in 30 minutes. If you did not ask for this, you can ignore this email.",
    html:
      "<p>" + hello + "</p>" +
      "<p>We received a request to reset your Subway password.</p>" +
      '<p><a href="' + safeLink + '">Choose a new password</a></p>' +
      "<p>The link works once and expires in 30 minutes. If you did not ask for this, you can ignore this email.</p>",
  });
}

module.exports = { sendEmail, sendPasswordResetEmail };
