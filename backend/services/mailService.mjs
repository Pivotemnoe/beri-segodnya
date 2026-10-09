import nodemailer from "nodemailer";

export function mailConfiguration() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const user = String(process.env.SMTP_USER || "").trim();
  const password = String(process.env.SMTP_PASSWORD || "");
  const port = Number(process.env.SMTP_PORT || 465);
  if (!host || !user || !password || ![465, 587].includes(port)) {
    throw Object.assign(new Error("Вход по почте пока недоступен. Попробуйте позже."), { status: 503, code: "MAIL_NOT_CONFIGURED", expose: true });
  }
  return { host, port, secure: port === 465, requireTLS: true, auth: { user, pass: password },
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true };
}

export async function sendCustomerCode(email, code) {
  const config = mailConfiguration();
  const transport = nodemailer.createTransport(config);
  try {
    const result = await transport.sendMail({
      from: { name: "Бери сегодня", address: config.auth.user },
      to: { address: email },
      subject: "Ваш код для входа в Бери сегодня",
      text: `Ваш код: ${code}\n\nВведите его на сайте или в приложении Бери сегодня. Код действует 10 минут и подходит только для одного входа.\n\nЕсли вы не запрашивали код, просто проигнорируйте это письмо. Никому не передавайте код — даже сотруднику заведения.\n\nБери сегодня\nhttps://berisegodnya.ru`,
      disableFileAccess: true, disableUrlAccess: true
    });
    if (!result.accepted?.includes(email)) throw new Error("RECIPIENT_NOT_ACCEPTED");
  } catch {
    // Never include the SMTP error: provider details can contain credentials or message content.
    throw Object.assign(new Error("Не удалось отправить код. Подождите немного и попробуйте снова."), { status: 503, code: "MAIL_DELIVERY_FAILED", expose: true });
  } finally { transport.close(); }
}
