// 한번봄(가칭) — 보고 나면 사라지는 사진
// · 시간·횟수·비밀번호로 열람 통제, 열람자 IP·시각 워터마크
// · 링크를 여는 것(GET)만으로는 조회수가 줄지 않고, '사진 보기' 버튼(POST)을 눌러야 소진된다
//   → 카카오톡 등 메신저가 미리보기를 만들려고 링크를 먼저 열어도 1회 열람이 날아가지 않음

import {
  BaseEnv, adminAction, adminOk, adminPage, checkKey, checkPassword, clientIp, esc, hashPassword, html, isBot, json, kst,
  layout, maskIp, message, newId, newKey, now, randomToken, redirect, remaining, reportPage, reportSubmit, sha256Hex, shortUa, withSecurity,
} from "./lib";

type Env = BaseEnv;

interface View {
  id: string; owner_hash: string; file_key: string | null; mime: string; created_at: number; expires_at: number;
  max_views: number | null; view_count: number; pw_hash: string | null; pw_fails: number; wm_ip: number; wm_text: string | null;
  revoked: number; last_viewed_at: number | null;
}

const EXPIRE_OPTIONS: [number, string][] = [[600, "10분"], [3600, "1시간"], [86400, "1일"], [3 * 86400, "3일"], [7 * 86400, "7일"]];
const VIEW_OPTIONS: [number, string][] = [[1, "1번 (보면 바로 사라짐)"], [3, "3번"], [10, "10번"], [0, "제한 없음(시간만)"]];
const MAX_BYTES = 10 * 1024 * 1024;
const TOKEN_TTL = 90;          // 이미지 접근권 수명(초)
const GRACE = 180;             // 마지막 열람 후 파일 삭제까지 여유(초)
const MAX_PW_FAILS = 10;

const gone = (v: View | null) =>
  !v || v.revoked === 1 || v.expires_at <= now() || !v.file_key || (v.max_views !== null && v.view_count >= v.max_views);

async function getView(env: Env, id: string): Promise<View | null> {
  return env.DB.prepare("SELECT * FROM views WHERE id=?").bind(id).first<View>();
}

async function deleteView(env: Env, id: string): Promise<void> {
  const v = await getView(env, id);
  if (v?.file_key) await env.BUCKET.delete(v.file_key);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM view_events WHERE view_id=?").bind(id),
    env.DB.prepare("DELETE FROM tokens WHERE view_id=?").bind(id),
    env.DB.prepare("DELETE FROM views WHERE id=?").bind(id),
  ]);
}

// ---------------- 화면 ----------------

function uploadPage(env: Env): Response {
  const exp = EXPIRE_OPTIONS.map(([v, l]) => `<option value="${v}"${v === 86400 ? " selected" : ""}>${l}</option>`).join("");
  const views = VIEW_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  return html(layout(env, {
    meta: { title: "한번봄 — 보고 나면 사라지는 사진", description: "가입 없이 사진을 올리고, 열람 횟수·시간·비밀번호를 정하세요. 보는 사람의 IP와 시각이 워터마크로 새겨집니다." },
    scripts: ["/view.js"],
    body: `<section class="hero"><h1>보고 나면 사라지는 사진</h1>
<p class="muted">가입 없이 올리고, 몇 번·언제까지 볼 수 있는지 정하세요. 보는 사람 화면에는 <b>그 사람의 IP와 열람 시각</b>이 워터마크로 새겨져요.</p></section>
<section class="card" id="uploader"><form class="form" id="upform">
<label>사진<input type="file" name="file" accept="image/*" required><span class="hint">올릴 때 촬영 위치(GPS)·기기 정보는 자동으로 지워져요.</span></label>
<div class="row"><label>열람 가능 횟수<select name="views">${views}</select></label>
<label>자동 삭제<select name="expire">${exp}</select></label></div>
<label>비밀번호 (선택)<input type="password" name="password" maxlength="64" autocomplete="new-password" placeholder="비워 두면 링크만으로 열람"><span class="hint">링크와 비밀번호는 서로 다른 경로로 보내는 게 안전해요.</span></label>
<label class="check"><input type="checkbox" name="wm_ip" value="1" checked><span>열람자의 IP·열람 시각을 워터마크로 표시</span></label>
<label>추가 워터마크 문구 (선택)<input name="wm_text" maxlength="40" placeholder="예: ○○부동산 제출용 · 2026-11-11"><span class="hint">신분증·서류 사본이라면 제출처와 용도를 적어 두세요.</span></label>
<label class="check"><input type="checkbox" name="agree" value="1" required><span>불법촬영물·타인의 사진 등 <a href="/terms">금지 콘텐츠</a>가 아님을 확인합니다.</span></label>
<button class="btn">링크 만들기</button><p class="small muted" id="upstatus"></p></form></section>
<section class="card hidden" id="result"><h2>링크가 만들어졌어요</h2>
<p class="small"><b>보낼 링크</b></p><div class="linkbox"><input readonly id="share"><button class="btn ghost sm copy" id="copyShare">복사</button></div>
<p class="small"><b>관리 링크</b> — 열람 현황 확인·회수용. 다시 보여드릴 수 없으니 꼭 보관하세요.</p>
<div class="linkbox"><input readonly id="manage"><button class="btn ghost sm copy" id="copyManage">복사</button></div>
<p><a class="btn ghost" id="manageGo" href="#">관리 페이지 열기</a></p></section>
<section class="card small muted"><h3>알아 두세요</h3><ul>
<li>링크를 카카오톡에 붙여 넣어도 미리보기 때문에 열람 횟수가 줄지 않아요. 상대가 ‘사진 보기’를 눌러야 1회가 차감됩니다.</li>
<li>웹 화면의 캡처·촬영은 기술적으로 완전히 막을 수 없어요. 워터마크는 “누가 언제 봤는지 남는다”는 억제 장치입니다.</li></ul></section>`,
  }));
}

function viewerPage(env: Env, v: View): Response {
  const left = v.max_views === null ? "횟수 제한 없음" : `${v.max_views - v.view_count}번 더 볼 수 있음`;
  return html(layout(env, {
    title: "사진이 도착했어요",
    meta: { title: "사진이 도착했어요", description: "열면 사라질 수 있어요 · 한번봄" },
    scripts: ["/view.js"],
    body: `<section class="card center" id="gate" data-id="${esc(v.id)}">
<h1>사진이 도착했어요</h1><p class="muted">${esc(left)} · ${remaining(v.expires_at)} 뒤 자동 삭제</p>
${v.max_views === 1 ? `<p class="note warn">한 번 열면 다시 볼 수 없어요. 준비됐을 때 열어 주세요.</p>` : ""}
<form id="openform" class="form">${v.pw_hash ? `<label>비밀번호<input type="password" name="password" required autocomplete="off"></label>` : ""}
<button class="btn block">사진 보기</button><p class="small muted" id="openstatus"></p></form></section>
<section class="viewer hidden" id="viewer"><canvas id="cv"></canvas><p class="small muted" id="viewinfo"></p></section>`,
  }));
}

function gonePage(env: Env): Response {
  return html(layout(env, {
    title: "사라진 사진",
    meta: { title: "사라진 사진이에요", description: "열람 횟수나 시간이 끝나 삭제된 사진입니다." },
    body: `<section class="card center"><h1>사라진 사진이에요</h1><p class="muted">열람 횟수나 보관 시간이 끝났거나, 보낸 사람이 회수했어요.</p><p><a class="btn ghost" href="/">나도 사진 보내기</a></p></section>`,
  }), 410);
}

async function managePage(env: Env, v: View, origin: string, key: string): Promise<Response> {
  const ev = (await env.DB.prepare("SELECT * FROM view_events WHERE view_id=? ORDER BY at DESC LIMIT 50").bind(v.id).all<{ at: number; ip_masked: string; ua: string }>()).results;
  const status = v.revoked ? "회수됨" : gone(v) ? "소진·만료됨(파일 삭제)" : "열람 가능";
  const share = `${origin}/v/${v.id}`;
  return html(layout(env, {
    title: "열람 현황", scripts: ["/view.js"],
    body: `<section class="card"><h1>열람 현황</h1>
<dl class="kv"><dt>상태</dt><dd><b>${status}</b></dd><dt>열람</dt><dd>${v.view_count}회${v.max_views !== null ? ` / ${v.max_views}회` : " (제한 없음)"}</dd>
<dt>마지막 열람</dt><dd>${kst(v.last_viewed_at, true)}</dd><dt>자동 삭제</dt><dd>${kst(v.expires_at)} (${remaining(v.expires_at)})</dd>
<dt>비밀번호</dt><dd>${v.pw_hash ? "사용" : "없음"}</dd><dt>워터마크</dt><dd>${v.wm_ip ? "열람자 IP·시각" : "IP 없음"}${v.wm_text ? ` + “${esc(v.wm_text)}”` : ""}</dd></dl>
<div class="linkbox"><input readonly value="${esc(share)}"><button class="btn ghost sm copy" data-copy="${esc(share)}">복사</button></div>
${!gone(v) ? `<form method="post" action="/v/${esc(v.id)}/revoke" class="form"><input type="hidden" name="key" value="${esc(key)}"><button class="btn danger">지금 회수하기 (즉시 삭제)</button></form>` : ""}</section>
<section class="card"><h2>열람 기록</h2>${ev.length ? `<table class="tbl"><tr><th>시각</th><th>IP(일부)</th><th>환경</th></tr>${ev.map((e) => `<tr><td>${kst(e.at, true)}</td><td class="mono">${esc(e.ip_masked)}</td><td>${esc(e.ua)}</td></tr>`).join("")}</table>` : `<p class="muted">아직 열람하지 않았어요.</p>`}</section>`,
  }));
}

function terms(env: Env): Response {
  return html(layout(env, {
    title: "이용약관·운영정책",
    body: `<section class="card"><h1>이용약관·운영정책 (초안)</h1><p class="muted small">공개 전 법률 검토 후 확정해야 하는 초안입니다.</p>
<h2>금지 콘텐츠</h2><ul><li>불법촬영물, 성적 촬영물, 아동·청소년 성착취물 등 법령상 유통이 금지된 정보</li><li>당사자 동의 없는 타인의 사진·신분증·개인정보</li><li>사기·피싱·저작권 침해물</li></ul>
<p>위반 콘텐츠는 신고 즉시 삭제하며 관련 법령에 따라 수사기관에 협조할 수 있습니다.</p>
<h2>개인정보</h2><ul><li>회원가입이 없습니다. 업로드 사진은 브라우저에서 촬영 위치(GPS) 등 메타데이터를 지운 사본으로 바꿔 저장합니다.</li>
<li>워터마크용 열람자 IP는 열람 순간 화면에만 그려지며, 열람 기록에는 앞 두 자리만 남깁니다(예: 123.45.*.*).</li>
<li>사진은 설정한 시간·횟수가 끝나면 자동 삭제되며, 보낸 사람이 언제든 회수할 수 있습니다.</li></ul>
<h2>책임의 한계</h2><p>화면 캡처·외부 촬영은 기술적으로 완전히 막을 수 없습니다. 민감한 사진은 보내기 전에 신중히 판단해 주세요.</p></section>`,
  }));
}

// ---------------- 처리 ----------------

function imageMime(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  return null;
}
const dec = (v: string | null) => { try { return decodeURIComponent(v ?? ""); } catch { return ""; } };

async function upload(env: Env, req: Request, origin: string): Promise<Response> {
  if (Number(req.headers.get("Content-Length") ?? 0) > MAX_BYTES) return json({ error: "사진이 너무 커요(최대 10MB)." }, 413);
  const buf = new Uint8Array(await req.arrayBuffer());
  const mime = imageMime(buf);
  if (!mime || buf.byteLength > MAX_BYTES) return json({ error: "JPEG·PNG 이미지만 올릴 수 있어요." }, 415);
  const expire = Number(req.headers.get("X-Expire"));
  const views = Number(req.headers.get("X-Max-Views"));
  if (!EXPIRE_OPTIONS.some(([v]) => v === expire) || !VIEW_OPTIONS.some(([v]) => v === views)) return json({ error: "잘못된 옵션입니다." }, 400);
  const pw = dec(req.headers.get("X-Password")).slice(0, 64);
  const id = newId(), key = newKey(), t = now();
  const fileKey = `v/${id}`;
  await env.BUCKET.put(fileKey, buf, { httpMetadata: { contentType: mime } });
  await env.DB.prepare(
    "INSERT INTO views(id, owner_hash, file_key, mime, created_at, expires_at, max_views, pw_hash, wm_ip, wm_text) VALUES(?,?,?,?,?,?,?,?,?,?)",
  ).bind(id, await sha256Hex(key), fileKey, mime, t, t + expire, views || null, pw ? await hashPassword(pw) : null,
    req.headers.get("X-Wm-Ip") === "1" ? 1 : 0, dec(req.headers.get("X-Wm-Text")).trim().slice(0, 40) || null).run();
  return json({ url: `${origin}/v/${id}`, manage: `${origin}/v/${id}/manage?key=${encodeURIComponent(key)}` });
}

async function openView(env: Env, req: Request, id: string): Promise<Response> {
  const v = await getView(env, id);
  if (gone(v)) return json({ error: "사라진 사진이에요." }, 410);
  const body = await req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
  if (v!.pw_hash) {
    if (v!.pw_fails >= MAX_PW_FAILS) return json({ error: "비밀번호를 너무 많이 틀려 잠겼어요." }, 423);
    if (!(await checkPassword(String(body.password ?? ""), v!.pw_hash))) {
      await env.DB.prepare("UPDATE views SET pw_fails=pw_fails+1 WHERE id=?").bind(id).run();
      return json({ error: `비밀번호가 맞지 않아요. (${MAX_PW_FAILS - v!.pw_fails - 1}번 남음)` }, 401);
    }
  }
  const t = now();
  // 조건부 원자적 차감: 동시에 두 명이 눌러도 1회짜리는 한 명만 성공
  const row = await env.DB.prepare(
    "UPDATE views SET view_count=view_count+1, last_viewed_at=? WHERE id=? AND revoked=0 AND expires_at>? AND file_key IS NOT NULL" +
    " AND (max_views IS NULL OR view_count<max_views) RETURNING view_count, max_views, wm_ip, wm_text",
  ).bind(t, id, t).first<{ view_count: number; max_views: number | null; wm_ip: number; wm_text: string | null }>();
  if (!row) return json({ error: "사라진 사진이에요." }, 410);
  const ip = clientIp(req);
  const token = randomToken(18);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO view_events(view_id, at, ip_masked, ua) VALUES(?,?,?,?)").bind(id, t, maskIp(ip), shortUa(req)),
    env.DB.prepare("INSERT INTO tokens(token, view_id, ip, expires_at) VALUES(?,?,?,?)").bind(token, id, ip, t + TOKEN_TTL),
  ]);
  const wm = [row.wm_ip ? `열람 ${ip} · ${kst(t, true)}` : "", row.wm_text ?? ""].filter(Boolean);
  const left = row.max_views === null ? null : row.max_views - row.view_count;
  return json({ img: `/i/${token}`, wm, left, expires: kst(v!.expires_at) });
}

async function serveImage(env: Env, req: Request, token: string): Promise<Response> {
  const tk = await env.DB.prepare("SELECT * FROM tokens WHERE token=? AND expires_at>?").bind(token, now()).first<{ view_id: string; ip: string }>();
  if (!tk || tk.ip !== clientIp(req)) return new Response("gone", { status: 410 });
  const v = await getView(env, tk.view_id);
  if (!v?.file_key || v.revoked || v.expires_at <= now()) return new Response("gone", { status: 410 });
  const obj = await env.BUCKET.get(v.file_key);
  if (!obj) return new Response("gone", { status: 410 });
  return new Response(obj.body, { headers: { "Content-Type": v.mime, "Cache-Control": "no-store, private", "Content-Disposition": "inline; filename=\"view\"" } });
}

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname, m = req.method;
  let r: RegExpMatchArray | null;

  if (path === "/" && m === "GET") return uploadPage(env);
  if (path === "/terms") return terms(env);
  if (path === "/report") return m === "POST" ? reportSubmit(env, req) : reportPage(env, url.searchParams.get("target") ?? "");
  if (path === "/admin" && m === "GET") {
    const t = url.searchParams.get("token");
    return adminOk(env, t) ? adminPage(env, t!) : message(env, "권한 없음", "관리자 토큰이 필요합니다.", 403);
  }
  if ((path === "/admin/takedown" || path === "/admin/dismiss") && m === "POST") return adminAction(env, req, path, "v", (id) => deleteView(env, id));
  if (path === "/api/upload" && m === "PUT") return upload(env, req, url.origin);

  if ((r = path.match(/^\/v\/([\w-]{6,20})$/)) && m === "GET") {
    const v = await getView(env, r[1]);
    if (gone(v)) return gonePage(env);
    return viewerPage(env, v!); // 봇·사람 모두 같은 화면(이미지 없음). 열람 차감은 POST에서만.
  }
  if ((r = path.match(/^\/v\/([\w-]{6,20})\/open$/)) && m === "POST") {
    if (isBot(req)) return json({ error: "bot" }, 403);
    return openView(env, req, r[1]);
  }
  if ((r = path.match(/^\/i\/([\w-]{20,40})$/)) && m === "GET") return serveImage(env, req, r[1]);
  if ((r = path.match(/^\/v\/([\w-]{6,20})\/manage$/)) && m === "GET") {
    const key = url.searchParams.get("key");
    const v = await getView(env, r[1]);
    if (!v) return message(env, "링크를 찾을 수 없어요", "만료되어 기록까지 삭제되었어요.", 404);
    if (!(await checkKey(key, v.owner_hash))) return message(env, "관리 권한이 없어요", "관리 링크 전체를 그대로 열어 주세요.", 403);
    return managePage(env, v, url.origin, key!);
  }
  if ((r = path.match(/^\/v\/([\w-]{6,20})\/revoke$/)) && m === "POST") {
    const key = String((await req.formData()).get("key") ?? "");
    const v = await getView(env, r[1]);
    if (!v || !(await checkKey(key, v.owner_hash))) return message(env, "관리 권한이 없어요", "관리 링크에서 다시 시도해 주세요.", 403);
    if (v.file_key) await env.BUCKET.delete(v.file_key);
    await env.DB.batch([
      env.DB.prepare("UPDATE views SET revoked=1, file_key=NULL WHERE id=?").bind(v.id),
      env.DB.prepare("DELETE FROM tokens WHERE view_id=?").bind(v.id),
    ]);
    return redirect(`/v/${v.id}/manage?key=${encodeURIComponent(key)}`);
  }
  return message(env, "페이지를 찾을 수 없어요", "주소를 다시 확인해 주세요.", 404);
}

async function cleanup(env: Env): Promise<void> {
  const t = now();
  const expired = (await env.DB.prepare("SELECT id FROM views WHERE expires_at<=? LIMIT 500").bind(t).all<{ id: string }>()).results;
  for (const v of expired) await deleteView(env, v.id);
  // 횟수를 다 쓴 사진은 마지막 열람 후 여유 시간이 지나면 파일만 삭제(관리 페이지 현황은 만료 때까지 유지)
  const spent = (await env.DB.prepare(
    "SELECT id, file_key FROM views WHERE file_key IS NOT NULL AND max_views IS NOT NULL AND view_count>=max_views AND last_viewed_at<=? LIMIT 500",
  ).bind(t - GRACE).all<{ id: string; file_key: string }>()).results;
  if (spent.length) {
    await env.BUCKET.delete(spent.map((s) => s.file_key));
    await env.DB.batch(spent.map((s) => env.DB.prepare("UPDATE views SET file_key=NULL WHERE id=?").bind(s.id)));
  }
  await env.DB.prepare("DELETE FROM tokens WHERE expires_at<=?").bind(t).run();
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return withSecurity(await handle(req, env));
    } catch (e) {
      console.error(e);
      return withSecurity(message(env, "일시적인 오류", "잠시 후 다시 시도해 주세요.", 500));
    }
  },
  async scheduled(_c: ScheduledController, env: Env): Promise<void> {
    await cleanup(env);
  },
} satisfies ExportedHandler<Env>;
