// 세 서비스가 각자 복사해서 쓰는 공통 유틸 (프로젝트 간 의존성 없음)

export interface BaseEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  SITE_NAME: string;
  SITE_TAGLINE?: string;
  IP_SALT?: string;
  ADMIN_TOKEN?: string;
}

export const now = (): number => Math.floor(Date.now() / 1000);

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const SECURITY_HEADERS: Record<string, string> = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export function withSecurity(res: Response): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  return r;
}

export function html(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function redirect(url: string, status = 303): Response {
  return new Response(null, { status, headers: { Location: url, "Cache-Control": "no-store" } });
}

export interface PageOpts {
  title?: string;
  body: string;
  meta?: { title: string; description: string };
  scripts?: string[];
  bodyClass?: string;
}

export function layout(env: BaseEnv, o: PageOpts): string {
  const site = esc(env.SITE_NAME);
  const title = o.title ? `${esc(o.title)} · ${site}` : site;
  const metaT = esc(o.meta?.title ?? env.SITE_NAME);
  const metaD = esc(o.meta?.description ?? env.SITE_TAGLINE ?? "");
  const scripts = (o.scripts ?? []).map((s) => `<script src="${esc(s)}" defer></script>`).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<meta property="og:title" content="${metaT}"><meta property="og:description" content="${metaD}">
<meta name="description" content="${metaD}">
<link rel="icon" href="data:,"><link rel="stylesheet" href="/style.css">${scripts}</head>
<body class="${esc(o.bodyClass ?? "")}">
<header class="top"><a class="brand" href="/">${site}</a><span class="tagline">${esc(env.SITE_TAGLINE ?? "")}</span></header>
<main class="wrap">${o.body}</main>
<footer class="foot"><a href="/terms">이용약관·운영정책</a> · <a href="/report">신고하기</a></footer>
</body></html>`;
}

export function message(env: BaseEnv, title: string, body: string, status = 200, back?: string): Response {
  const btn = back ? `<a class="btn ghost" href="${esc(back)}">돌아가기</a>` : `<a class="btn ghost" href="/">처음으로</a>`;
  return html(layout(env, { title, body: `<section class="card center"><h1>${esc(title)}</h1><p>${esc(body)}</p><p>${btn}</p></section>` }), status);
}

// ---------- ID·키·해시 ----------

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(nBytes: number): string {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

export const newId = () => randomToken(7);      // 공유 링크용(약 10자)
export const newKey = () => randomToken(24);    // 관리 링크용 비밀키

export function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", buf));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function checkKey(key: string | null, storedHash: string): Promise<boolean> {
  if (!key) return false;
  return timingSafeEqual(await sha256Hex(key), storedHash);
}

// 비밀번호: PBKDF2. 무료 플랜 CPU 한도(요청당 10ms)를 고려해 반복 횟수를 낮게 잡음.
const PBKDF2_ITER = 10_000;

export async function hashPassword(pw: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const h = await pbkdf2(pw, salt, PBKDF2_ITER);
  return `${PBKDF2_ITER}$${toHex(salt.buffer)}$${h}`;
}

export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [iter, saltHex, h] = stored.split("$");
  if (!iter || !saltHex || !h) return false;
  return timingSafeEqual(await pbkdf2(pw, hexToBytes(saltHex), Number(iter)), h);
}

async function pbkdf2(pw: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return toHex(bits);
}

// ---------- 요청 정보 ----------

export function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP") ?? "0.0.0.0";
}

export function maskIp(ip: string): string {
  if (ip.includes(".")) {
    const p = ip.split(".");
    return `${p[0]}.${p[1]}.*.*`;
  }
  return ip.split(":").slice(0, 2).join(":") + ":*";
}

export async function ipHash(env: BaseEnv, ip: string): Promise<string> {
  return (await sha256Hex((env.IP_SALT ?? "dev-salt") + ip)).slice(0, 16);
}

// 카카오톡·메신저·검색엔진 링크 미리보기 봇
const BOT_MARKERS = [
  "kakaotalk-scrap", "kakaostory-og-reader", "daum", "yeti", "naver",
  "facebookexternalhit", "facebot", "twitterbot", "slackbot", "discordbot",
  "telegrambot", "whatsapp", "linkedinbot", "skypeuripreview", "line/",
  "googlebot", "bingbot", "applebot", "iframely", "embedly", "pinterest",
  "bot", "crawler", "spider", "preview", "headless",
];

export function isBot(req: Request): boolean {
  const ua = (req.headers.get("User-Agent") ?? "").toLowerCase();
  return !ua || BOT_MARKERS.some((m) => ua.includes(m));
}

export function shortUa(req: Request): string {
  const ua = req.headers.get("User-Agent") ?? "";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : "기타";
  const app = /KAKAOTALK/i.test(ua) ? "카카오톡 인앱" : /NAVER/i.test(ua) ? "네이버 앱" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "브라우저";
  return `${os} · ${app}`;
}

// ---------- 시간(KST) ----------

const KST_OFFSET = 9 * 3600;

export function kst(ts: number | null | undefined, withSec = false): string {
  if (!ts) return "-";
  const d = new Date((ts + KST_OFFSET) * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const base = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return withSec ? `${base}:${p(d.getUTCSeconds())}` : base;
}

/** "2026-11-11T23:30" (KST 기준 datetime-local) → epoch 초 */
export function parseLocalKst(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  return Math.floor(Date.UTC(y, mo - 1, d, h, mi) / 1000) - KST_OFFSET;
}

export function remaining(ts: number | null | undefined): string {
  if (!ts) return "-";
  let sec = ts - now();
  if (sec <= 0) return "만료됨";
  const d = Math.floor(sec / 86400); sec %= 86400;
  const h = Math.floor(sec / 3600); sec %= 3600;
  const m = Math.floor(sec / 60);
  if (d) return `${d}일 ${h}시간`;
  if (h) return `${h}시간 ${m}분`;
  return `${Math.max(m, 1)}분`;
}

export function shortHash(h: string | null | undefined, n = 16): string {
  if (!h) return "-";
  return (h.slice(0, n).match(/.{1,4}/g) ?? []).join(" ");
}

// ---------- 신고·관리자(서비스 공통) ----------

export const REPORT_REASONS = ["불법촬영물·성적 콘텐츠", "개인정보 노출", "사기·피싱", "저작권 침해", "기타"];

export function reportPage(env: BaseEnv, target = ""): Response {
  const opts = REPORT_REASONS.map((r) => `<option>${esc(r)}</option>`).join("");
  return html(layout(env, {
    title: "신고하기",
    body: `<section class="card"><h1>신고하기</h1>
<p class="muted">불법촬영물·개인정보 노출 등 문제가 있는 링크를 알려 주세요. 확인 즉시 삭제합니다.</p>
<form method="post" action="/report" class="form">
<label>문제가 있는 링크<input name="target" value="${esc(target)}" placeholder="https://…" required maxlength="300"></label>
<label>사유<select name="reason">${opts}</select></label>
<label>상세 내용 (선택)<textarea name="detail" rows="4" maxlength="2000"></textarea></label>
<button class="btn">신고 접수</button></form></section>`,
  }));
}

export async function reportSubmit(env: BaseEnv, req: Request): Promise<Response> {
  const f = await req.formData();
  const target = String(f.get("target") ?? "").trim().slice(0, 300);
  if (!target) return message(env, "신고 대상이 비어 있어요", "문제가 있는 링크 주소를 입력해 주세요.", 400, "/report");
  await env.DB.prepare("INSERT INTO reports(target, reason, detail, created_at, ip_hash) VALUES(?,?,?,?,?)")
    .bind(target, String(f.get("reason") ?? "기타").slice(0, 50), String(f.get("detail") ?? "").slice(0, 2000), now(), await ipHash(env, clientIp(req)))
    .run();
  return message(env, "신고가 접수되었습니다", "확인 후 신속히 조치하겠습니다. 감사합니다.");
}

export function adminOk(env: BaseEnv, token: string | null): boolean {
  return !!env.ADMIN_TOKEN && !!token && timingSafeEqual(token, env.ADMIN_TOKEN);
}

interface ReportRow { id: number; target: string; reason: string; detail: string; created_at: number; handled: number }

export async function adminPage(env: BaseEnv, token: string): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT * FROM reports ORDER BY handled, id DESC LIMIT 200").all<ReportRow>();
  const rows = results.map((r) => `<tr class="${r.handled ? "done" : ""}"><td>${r.id}</td><td>${kst(r.created_at)}</td>
<td class="break">${esc(r.target)}</td><td>${esc(r.reason)}</td><td class="break">${esc(r.detail)}</td><td>${r.handled ? "처리됨" : `
<form method="post" action="/admin/takedown" class="inline"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="id" value="${r.id}"><button class="btn danger sm">삭제 조치</button></form>
<form method="post" action="/admin/dismiss" class="inline"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="id" value="${r.id}"><button class="btn ghost sm">기각</button></form>`}</td></tr>`).join("");
  return html(layout(env, {
    title: "신고 관리",
    body: `<section class="card"><h1>신고 관리</h1><table class="tbl"><tr><th>#</th><th>접수</th><th>대상</th><th>사유</th><th>상세</th><th>처리</th></tr>${rows || `<tr><td colspan="6" class="muted">접수된 신고가 없습니다.</td></tr>`}</table></section>`,
  }));
}

/** 신고 링크에서 경로의 객체 ID 추출: https://x/v/AbC → AbC (prefix = "v") */
export function extractId(target: string, prefix: string): string | null {
  const parts = target.split("?")[0].split("#")[0].split("/").filter(Boolean);
  const i = parts.indexOf(prefix);
  return i >= 0 && parts[i + 1] ? parts[i + 1] : null;
}

export async function adminAction(env: BaseEnv, req: Request, path: string, prefix: string, deleteFn: (id: string) => Promise<void>): Promise<Response> {
  const f = await req.formData();
  const token = String(f.get("token") ?? "");
  if (!adminOk(env, token)) return message(env, "권한 없음", "관리자 토큰이 필요합니다.", 403);
  const id = Number(f.get("id"));
  const row = await env.DB.prepare("SELECT target FROM reports WHERE id=?").bind(id).first<{ target: string }>();
  if (row && path === "/admin/takedown") {
    const oid = extractId(row.target, prefix);
    if (oid) await deleteFn(oid);
  }
  await env.DB.prepare("UPDATE reports SET handled=1 WHERE id=?").bind(id).run();
  return redirect(`/admin?token=${encodeURIComponent(token)}`);
}

export const REPORTS_SCHEMA = `CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT,
  created_at INTEGER NOT NULL, ip_hash TEXT, handled INTEGER NOT NULL DEFAULT 0);`;
