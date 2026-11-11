// 그때열기(가칭) — 정한 시각에 열리고, 정한 시간이 지나면 사라지는 링크
// · 공개 전: 카운트다운만 보이고, 카톡 미리보기에는 "○시에 열려요"가 뜬다(본문·사진은 서버가 내보내지 않음)
// · 공개 후: 메시지·사진 표시 / 종료 시각이 지나면 접속 즉시 또는 정리 작업에서 삭제

import {
  BaseEnv, adminAction, adminOk, adminPage, checkKey, esc, html, json, kst, layout, message, newId, newKey, now,
  parseLocalKst, remaining, reportPage, reportSubmit, sha256Hex, withSecurity,
} from "./lib";

type Env = BaseEnv;

interface Capsule {
  id: string; owner_hash: string; sender: string | null; teaser: string | null; message: string; file_key: string | null;
  open_at: number; close_at: number; created_at: number;
}

const CLOSE_OPTIONS: [number, string][] = [[3600, "열린 뒤 1시간"], [86400, "열린 뒤 1일"], [7 * 86400, "열린 뒤 7일"], [30 * 86400, "열린 뒤 30일"]];
const MAX_IMG = 6 * 1024 * 1024;
const MAX_AHEAD = 366 * 86400;

async function getCap(env: Env, id: string): Promise<Capsule | null> {
  return env.DB.prepare("SELECT * FROM capsules WHERE id=?").bind(id).first<Capsule>();
}

async function deleteCap(env: Env, id: string): Promise<void> {
  const c = await getCap(env, id);
  if (c?.file_key) await env.BUCKET.delete(c.file_key);
  await env.DB.prepare("DELETE FROM capsules WHERE id=?").bind(id).run();
}

const who = (c: Capsule) => (c.sender ? `${c.sender}님` : "누군가");

// ---------------- 화면 ----------------

function createPage(env: Env): Response {
  const close = CLOSE_OPTIONS.map(([v, l]) => `<option value="${v}"${v === 7 * 86400 ? " selected" : ""}>${l}</option>`).join("");
  return html(layout(env, {
    meta: { title: "그때열기 — 정한 시각에 열리는 링크", description: "생일 0시, 기념일, 발표 시각… 미리 보내 두면 그 시각에 열리고, 정한 시간이 지나면 사라져요." },
    scripts: ["/geuttae.js"],
    body: `<section class="home">
<div class="home-copy"><p class="eyebrow">${esc(env.SITE_TAGLINE)}</p>
<h1>그 시각이 되면<br>열리는 링크.</h1>
<p class="lead">생일 0시, 기념일, 발표 시각… 지금 미리 보내 두세요. 그 전에는 카운트다운만 보이고, 정한 시간이 지나면 사라져요.</p></div>
<div class="home-side">
<section class="panel" id="creator"><form class="form" id="capform">
<label>보내는 사람 (선택)<input name="sender" maxlength="20" placeholder="예: 준영"></label>
<label>열리는 시각 (한국 시간)<input type="datetime-local" name="open_at" required></label>
<label>잠겨 있는 동안 보일 문구 (선택)<input name="teaser" maxlength="60" placeholder="예: 생일 0시에 열어 봐"></label>
<label>메시지<textarea name="message" rows="4" maxlength="2000" required placeholder="열린 뒤에 보일 내용"></textarea></label>
<label>사진 (선택)<input type="file" name="photo" accept="image/*"><span class="hint">촬영 위치와 기기 정보는 올릴 때 지워져요.</span></label>
<label>사라지는 시각<select name="close_after">${close}</select></label>
<label class="check"><input type="checkbox" name="agree" value="1" required><span>불법촬영물·타인의 사진 등 <a href="/terms">금지 콘텐츠</a>가 아님을 확인합니다.</span></label>
<button class="btn block">예약 링크 만들기</button><p class="small muted" id="capstatus"></p></form></section>
<section class="panel hidden" id="capresult"><h2>예약 링크가 만들어졌어요</h2>
<p id="capwhen" class="note ok"></p>
<p class="small"><b>보낼 링크</b> — 지금 보내도 그 시각 전에는 열리지 않아요.</p>
<div class="linkbox"><input readonly id="share"><button type="button" class="btn ghost sm copy">복사</button></div>
<button type="button" class="btn block" id="share-send">카톡 등으로 보내기</button>
<p class="small"><b>관리 링크</b> — 내용 확인·삭제용. 다시 보여드릴 수 없으니 꼭 보관하세요.</p>
<div class="linkbox"><input readonly id="manage"><button type="button" class="btn ghost sm copy">복사</button></div></section>
</div></section>`,
  }));
}

function lockedPage(env: Env, c: Capsule): Response {
  return html(layout(env, {
    title: "아직 열리지 않았어요", scripts: ["/geuttae.js"],
    meta: { title: `🔒 ${who(c)}이 보낸 메시지`, description: `${kst(c.open_at)}에 열려요 · 그때열기` },
    body: `<section class="card center capsule"><p class="muted">${esc(who(c))}이 보낸 메시지</p>
<h1>${esc(c.teaser || "아직 열리지 않았어요")}</h1>
<p class="big countdown" id="countdown" data-open="${c.open_at}" data-now="${now()}">--:--:--</p>
<p class="muted">${kst(c.open_at)}에 열려요 (한국 시간)</p>
<p class="small muted">이 페이지를 열어 두면 시간이 되었을 때 자동으로 열립니다.</p></section>`,
  }));
}

function openedPage(env: Env, c: Capsule): Response {
  return html(layout(env, {
    title: `${who(c)}이 보낸 메시지`,
    meta: { title: `💌 ${who(c)}이 보낸 메시지`, description: `${kst(c.open_at)}에 열린 메시지 · ${kst(c.close_at)}에 사라져요` },
    body: `<section class="card capsule"><p class="muted">${esc(who(c))}이 보낸 메시지 · ${kst(c.open_at)} 열림</p>
<div class="letter">${esc(c.message)}</div>${c.file_key ? `<img src="/t/${esc(c.id)}/img" alt="첨부 사진">` : ""}
<p class="small muted">이 메시지는 ${kst(c.close_at)}에 사라져요 (${remaining(c.close_at)} 남음).</p></section>
<p class="center small"><a href="/">나도 예약 메시지 보내기</a></p>`,
  }));
}

function gonePage(env: Env): Response {
  return html(layout(env, {
    title: "사라진 메시지",
    meta: { title: "사라진 메시지예요", description: "공개 기간이 끝나 삭제된 메시지입니다." },
    body: `<section class="card center"><h1>사라진 메시지예요</h1><p class="muted">공개 기간이 끝났거나 보낸 사람이 삭제했어요.</p><p><a class="btn ghost" href="/">나도 예약 메시지 보내기</a></p></section>`,
  }), 410);
}

function managePage(env: Env, c: Capsule, origin: string, key: string): Response {
  const share = `${origin}/t/${c.id}`;
  const state = now() < c.open_at ? `잠김 — ${remaining(c.open_at)} 뒤 열림` : `열림 — ${remaining(c.close_at)} 뒤 사라짐`;
  return html(layout(env, {
    title: "예약 메시지 관리", scripts: ["/geuttae.js"],
    body: `<section class="card"><h1>예약 메시지 관리</h1>
<dl class="kv"><dt>상태</dt><dd><b>${state}</b></dd><dt>열리는 시각</dt><dd>${kst(c.open_at)}</dd><dt>사라지는 시각</dt><dd>${kst(c.close_at)}</dd>
<dt>보낸 사람</dt><dd>${esc(c.sender || "(표시 안 함)")}</dd><dt>잠김 문구</dt><dd>${esc(c.teaser || "(기본 문구)")}</dd></dl>
<div class="linkbox"><input readonly value="${esc(share)}"><button class="btn ghost sm copy" data-copy="${esc(share)}">복사</button></div></section>
<section class="card"><h2>보낸 내용 (나만 보임)</h2><div class="letter">${esc(c.message)}</div>${c.file_key ? `<p class="small muted">사진 1장 첨부됨(열린 뒤 공개)</p>` : ""}</section>
<section class="card"><form method="post" action="/t/${esc(c.id)}/delete" class="form"><input type="hidden" name="key" value="${esc(key)}">
<button class="btn danger">지금 삭제하기</button></form></section>`,
  }));
}

function terms(env: Env): Response {
  return html(layout(env, {
    title: "이용약관·운영정책",
    body: `<section class="card"><h1>이용약관·운영정책 (초안)</h1><p class="muted small">공개 전 법률 검토 후 확정해야 하는 초안입니다.</p>
<h2>금지 콘텐츠</h2><ul><li>불법촬영물, 성적 촬영물, 아동·청소년 성착취물 등 법령상 유통이 금지된 정보</li><li>협박·괴롭힘·사기·피싱 목적의 메시지, 타인의 개인정보</li></ul>
<p>위반 콘텐츠는 신고 즉시 삭제하며 관련 법령에 따라 수사기관에 협조할 수 있습니다.</p>
<h2>개인정보</h2><ul><li>회원가입이 없습니다. 보낸 사람 이름은 입력한 경우에만 표시됩니다.</li><li>사진은 브라우저에서 촬영 위치(GPS) 등 메타데이터를 지운 사본으로 저장됩니다.</li>
<li>메시지와 사진은 정한 ‘사라지는 시각’에 삭제되며, 보낸 사람은 언제든 직접 삭제할 수 있습니다.</li></ul></section>`,
  }));
}

// ---------------- 처리 ----------------

async function create(env: Env, req: Request, origin: string): Promise<Response> {
  if (Number(req.headers.get("Content-Length") ?? 0) > MAX_IMG + 64 * 1024) return json({ error: "사진이 너무 커요." }, 413);
  const f = await req.formData();
  const msg = String(f.get("message") ?? "").trim().slice(0, 2000);
  const openAt = parseLocalKst(String(f.get("open_at") ?? ""));
  const closeAfter = Number(f.get("close_after"));
  const t = now();
  if (!msg) return json({ error: "메시지를 입력해 주세요." }, 400);
  if (openAt === null || openAt < t - 60 || openAt > t + MAX_AHEAD) return json({ error: "열리는 시각은 지금부터 1년 이내로 정해 주세요." }, 400);
  if (!CLOSE_OPTIONS.some(([v]) => v === closeAfter)) return json({ error: "잘못된 옵션입니다." }, 400);
  const id = newId(), key = newKey();
  let fileKey: string | null = null;
  const photo = f.get("photo");
  if (photo && typeof photo !== "string" && photo.size > 0) {
    const buf = new Uint8Array(await photo.arrayBuffer());
    if (buf.byteLength > MAX_IMG || !(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return json({ error: "사진은 6MB 이하 이미지만 가능해요." }, 415);
    fileKey = `t/${id}`;
    await env.BUCKET.put(fileKey, buf, { httpMetadata: { contentType: "image/jpeg" } });
  }
  await env.DB.prepare("INSERT INTO capsules(id, owner_hash, sender, teaser, message, file_key, open_at, close_at, created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(id, await sha256Hex(key), String(f.get("sender") ?? "").trim().slice(0, 20) || null,
      String(f.get("teaser") ?? "").trim().slice(0, 60) || null, msg, fileKey, openAt, openAt + closeAfter, t).run();
  return json({ url: `${origin}/t/${id}`, manage: `${origin}/t/${id}/manage?key=${encodeURIComponent(key)}`, opens: kst(openAt), closes: kst(openAt + closeAfter) });
}

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname, m = req.method;
  let r: RegExpMatchArray | null;

  if (path === "/" && m === "GET") return createPage(env);
  if (path === "/terms") return terms(env);
  if (path === "/report") return m === "POST" ? reportSubmit(env, req) : reportPage(env, url.searchParams.get("target") ?? "");
  if (path === "/admin" && m === "GET") {
    const t = url.searchParams.get("token");
    return adminOk(env, t) ? adminPage(env, t!) : message(env, "권한 없음", "관리자 토큰이 필요합니다.", 403);
  }
  if ((path === "/admin/takedown" || path === "/admin/dismiss") && m === "POST") return adminAction(env, req, path, "t", (id) => deleteCap(env, id));
  if (path === "/api/create" && m === "POST") return create(env, req, url.origin);

  if ((r = path.match(/^\/t\/([\w-]{6,20})$/)) && m === "GET") {
    const c = await getCap(env, r[1]);
    if (!c) return gonePage(env);
    if (c.close_at <= now()) { await deleteCap(env, c.id); return gonePage(env); }
    return now() < c.open_at ? lockedPage(env, c) : openedPage(env, c);
  }
  if ((r = path.match(/^\/t\/([\w-]{6,20})\/img$/)) && m === "GET") {
    const c = await getCap(env, r[1]);
    const t = now();
    if (!c?.file_key || t < c.open_at || t >= c.close_at) return new Response("not available", { status: 404 });
    const obj = await env.BUCKET.get(c.file_key);
    if (!obj) return new Response("not available", { status: 404 });
    return new Response(obj.body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300" } });
  }
  if ((r = path.match(/^\/t\/([\w-]{6,20})\/manage$/)) && m === "GET") {
    const key = url.searchParams.get("key");
    const c = await getCap(env, r[1]);
    if (!c || c.close_at <= now()) return message(env, "메시지를 찾을 수 없어요", "이미 사라졌거나 삭제된 메시지입니다.", 404);
    if (!(await checkKey(key, c.owner_hash))) return message(env, "관리 권한이 없어요", "관리 링크 전체를 그대로 열어 주세요.", 403);
    return managePage(env, c, url.origin, key!);
  }
  if ((r = path.match(/^\/t\/([\w-]{6,20})\/delete$/)) && m === "POST") {
    const key = String((await req.formData()).get("key") ?? "");
    const c = await getCap(env, r[1]);
    if (!c || !(await checkKey(key, c.owner_hash))) return message(env, "관리 권한이 없어요", "관리 링크에서 다시 시도해 주세요.", 403);
    await deleteCap(env, c.id);
    return message(env, "삭제했어요", "메시지와 사진이 지워졌습니다. 링크를 열어도 더 이상 보이지 않아요.");
  }
  return message(env, "페이지를 찾을 수 없어요", "주소를 다시 확인해 주세요.", 404);
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
    const { results } = await env.DB.prepare("SELECT id FROM capsules WHERE close_at<=? LIMIT 500").bind(now()).all<{ id: string }>();
    for (const c of results) await deleteCap(env, c.id);
  },
} satisfies ExportedHandler<Env>;

