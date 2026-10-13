export function adminEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 80 || !/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email) || email.includes("..")) {
    throw Object.assign(new Error("Укажите почту администратора — на неё можно будет восстановить пароль."), { status: 400, code: "INVALID_ADMIN_EMAIL" });
  }
  return email;
}
