// 방도장(가칭) — 입주·퇴실 집 상태 기록 링크
// 사진 원본의 SHA-256은 브라우저가 계산하고, R2가 저장 시점에 실제 바이트와 대조해 검증한다.
// 집주인·중개사가 공유 링크에서 '확인했습니다'를 누르면 그 순간의 사진 묶음 지문과 시각이 남는다.

import {
  BaseEnv, adminAction, adminOk, adminPage, checkKey, clientIp, esc, hexToBytes, html, ipHash, json, kst,
  layout, message, newId, newKey, now, redirect, remaining, reportPage, reportSubmit, sha256Hex, shortHash, withSecurity,
} from "./lib";

interface Env extends BaseEnv { MAX_PHOTOS: string }

interface Rec { id: string; owner_hash: string; title: string; note: string; created_at: number; expires_at: number }
interface Photo {
  id: string; record_id: string; stage: string; room: string; orig_key: string; disp_key: string | null;
  sha256: string; size: number; received_at: number; taken_at: string | null; orig_name: string | null;
}
interface Ack { id: number; stage: string; name: string; role: string; manifest: string; photo_ids: string; photo_count: number; acked_at: number }

const STAGES: Record<string, string> = { in: "입주", out: "퇴실" };
const ROOMS = ["현관", "거실", "방1", "방2", "방3", "주방", "욕실", "베란다", "창문·창틀", "벽·천장", "바닥", "옵션 가전", "기타"];
const ROLES = ["임대인(집주인)", "공인중개사", "관리인", "임차인", "기타"];
const YEAR = 365 * 86400;
const MAX_ORIG = 30 * 1024 * 1024;
const MAX_DISP = 6 * 1024 * 1024;

// ---------------- 데이터 ----------------

async function getRec(env: Env, id: string): Promise<Rec | null> {
  return env.DB.prepare("SELECT * FROM records WHERE id=? AND expires_at>?").bind(id, now()).first<Rec>();
}

async function getPhotos(env: Env, rid: string, stage?: string): Promise<Photo[]> {
  const q = stage
    ? env.DB.prepare("SELECT * FROM record_photos WHERE record_id=? AND stage=? ORDER BY received_at, id").bind(rid, stage)
    : env.DB.prepare("SELECT * FROM record_photos WHERE record_id=? ORDER BY received_at, id").bind(rid);
  return (await q.all<Photo>()).results;
}

async function manifestOf(photos: Photo[]): Promise<string> {
  const lines = photos.map((p) => `${p.id}|${p.sha256}|${p.received_at}`).sort();
  return sha256Hex(lines.join("\n"));
}

async function deleteRecord(env: Env, rid: string): Promise<void> {
  const photos = await getPhotos(env, rid);
  const keys = photos.flatMap((p) => [p.orig_key, p.disp_key].filter(Boolean) as string[]);
  for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM record_photos WHERE record_id=?").bind(rid),
    env.DB.prepare("DELETE FROM record_acks WHERE record_id=?").bind(rid),
    env.DB.prepare("DELETE FROM records WHERE id=?").bind(rid),
  ]);
}

interface StageVM { code: string; label: string; photos: Photo[]; rooms: Map<string, Photo[]>; acks: Ack[]; manifest: string | null }

async function viewModel(env: Env, rid: string) {
  const rec = await getRec(env, rid);
  if (!rec) return null;
  const all = await getPhotos(env, rid);
  const acks = (await env.DB.prepare("SELECT * FROM record_acks WHERE record_id=? ORDER BY acked_at").bind(rid).all<Ack>()).results;
  const stages: StageVM[] = [];
  for (const [code, label] of Object.entries(STAGES)) {
    const photos = all.filter((p) => p.stage === code);
    const rooms = new Map<string, Photo[]>();
    for (const p of photos) rooms.set(p.room, [...(rooms.get(p.room) ?? []), p]);
    stages.push({ code, label, photos, rooms, acks: acks.filter((a) => a.stage === code), manifest: photos.length ? await manifestOf(photos) : null });
  }
  const compare: [string, Photo[], Photo[]][] = [];
  for (const [room, ins] of stages[0].rooms) {
    const outs = stages[1].rooms.get(room);
    if (outs?.length) compare.push([room, ins, outs]);
  }
  return { rec, stages, compare };
}

// ---------------- 화면 ----------------

function landing(env: Env): Response {
  return html(layout(env, {
    meta: { title: "방도장 — 입주·퇴실 집 상태 기록", description: "사진을 올리면 받은 시각과 파일 지문이 고정돼요. 집주인이 링크에서 확인하면 그 시각까지 남습니다." },
    body: `<section class="hero"><h1>보증금, 입주 첫날 사진이 지켜요.</h1>
<p class="muted">사진을 올리면 <b>서버가 받은 시각</b>과 <b>원본 파일 지문(SHA-256)</b>이 고정됩니다. 집주인·중개사가 링크에서 <b>“확인했습니다”</b>를 누르면 그 시각까지 함께 남아요. 퇴실 때는 같은 링크에 사진을 더해 방별로 나란히 비교하세요.</p></section>
<section class="card"><h2>새 기록 만들기</h2>
<form method="post" action="/new" class="form">
<label>기록 이름<input name="title" required maxlength="80" placeholder="예: ○○빌라 301호 입주 기록"></label>
<label>메모 (선택)<span class="hint">계약 기간, 특약 등. 주소·전화번호 같은 개인정보는 적지 않는 걸 권해요.</span>
<textarea name="note" rows="2" maxlength="500"></textarea></label>
<label>보관 기간<select name="years"><option value="1">1년</option><option value="2" selected>2년 (일반 임대차)</option><option value="3">3년</option></select></label>
<button class="btn">기록 만들기 (가입 없음)</button></form></section>
<section class="card small muted"><h3>이렇게 쓰세요</h3><ol>
<li>입주 당일, 짐을 들이기 전에 방별로 사진을 올립니다.</li>
<li>공유 링크를 카톡으로 집주인·중개사에게 보내 “확인했습니다”를 받아 둡니다.</li>
<li>퇴실할 때 같은 관리 링크에서 퇴실 사진을 올리면 방별 비교 화면이 생깁니다.</li></ol>
<p>※ 이 기록은 분쟁 시 참고 자료가 될 수 있지만 공증이 아니며 법적 효력을 보장하지 않습니다.</p></section>`,
  }));
}

function photoCard(rid: string, p: Photo, opts: { owner: boolean; key?: string; afterAck: boolean }): string {
  const img = p.disp_key
    ? `<img src="/r/${esc(rid)}/img/${esc(p.id)}" alt="${esc(p.room)}" loading="lazy">`
    : `<div class="noimg">미리보기 없음</div>`;
  const ownerTools = opts.owner
    ? `<div><a href="/r/${esc(rid)}/orig/${esc(p.id)}?key=${esc(opts.key)}">원본 받기</a>
<form method="post" action="/r/${esc(rid)}/del/${esc(p.id)}" class="inline"><input type="hidden" name="key" value="${esc(opts.key)}"> · <button class="linklike">삭제</button></form></div>`
    : "";
  return `<figure class="ph">${img}<figcaption class="meta"><b>${esc(p.room)}</b><br>
받은 시각 ${kst(p.received_at, true)}<br>${p.taken_at ? `촬영(EXIF) ${esc(p.taken_at)}<br>` : ""}
<span class="mono">지문 ${shortHash(p.sha256)}…</span>${opts.afterAck ? `<br><span class="badge">마지막 확인 이후 추가</span>` : ""}${ownerTools}</figcaption></figure>`;
}

function stageSection(rid: string, st: StageVM, opts: { owner: boolean; key?: string }): string {
  const lastIds = st.acks.length ? new Set(st.acks[st.acks.length - 1].photo_ids.split(",")) : null;
  const rooms = [...st.rooms.entries()].map(([room, ps]) =>
    `<h3>${esc(room)} <span class="muted small">${ps.length}장</span></h3><div class="grid">${ps.map((p) => photoCard(rid, p, { ...opts, afterAck: lastIds !== null && !lastIds.has(p.id) })).join("")}</div>`).join("");
  const acks = st.acks.length
    ? `<ul class="acks">${st.acks.map((a) => `<li>✅ <b>${esc(a.name)}</b> (${esc(a.role)}) — ${kst(a.acked_at, true)} 확인 · 사진 ${a.photo_count}장 · <span class="mono">묶음 지문 ${shortHash(a.manifest, 12)}…</span></li>`).join("")}</ul>`
    : st.photos.length ? `<p class="note warn">아직 상대방 확인이 없어요. 공유 링크를 보내 확인을 받아 두세요.</p>` : "";
  const uploader = opts.owner ? `<form class="uploader form card" data-rid="${esc(rid)}" data-key="${esc(opts.key)}" data-stage="${st.code}">
<h3>${st.label} 사진 올리기</h3>
<label>공간<input name="room" list="rooms" required maxlength="30" placeholder="예: 거실"><span class="hint">목록에서 고르거나 직접 입력</span></label>
<label>사진 (여러 장 가능)<input type="file" name="files" accept="image/*" multiple required></label>
<button class="btn">올리기</button><ul class="progress"></ul></form>` : "";
  const ackForm = !opts.owner && st.photos.length ? `<form method="post" action="/r/${esc(rid)}/ack" class="form card">
<h3>${st.label} 상태 확인하기</h3><input type="hidden" name="stage" value="${st.code}">
<div class="row"><label>이름<input name="name" required maxlength="30" placeholder="예: 김○○"></label>
<label>역할<select name="role">${ROLES.map((r) => `<option>${esc(r)}</option>`).join("")}</select></label></div>
<label class="check"><input type="checkbox" name="agree" value="1" required><span>위 사진 ${st.photos.length}장이 ${st.label} 시점의 집 상태임을 확인했습니다.</span></label>
<button class="btn">확인했습니다</button></form>` : "";
  return `<section class="card stage" id="stage-${st.code}"><h2>${st.label} 기록 <span class="pill">${st.photos.length}장</span></h2>
${st.manifest ? `<p class="small muted">현재 사진 묶음 지문 <span class="mono">${shortHash(st.manifest, 24)}…</span></p>` : ""}
${acks}${rooms || `<p class="muted">아직 사진이 없어요.</p>`}${ackForm}${uploader}</section>`;
}

function recordPage(env: Env, vm: NonNullable<Awaited<ReturnType<typeof viewModel>>>, origin: string, o: { owner: boolean; key?: string; created?: boolean; err?: string; acked?: boolean }): Response {
  const { rec, stages, compare } = vm;
  const share = `${origin}/r/${rec.id}`;
  const manage = `${origin}/r/${rec.id}/manage?key=${o.key ?? ""}`;
  const links = o.owner ? `<section class="card"><h2>링크</h2>
${o.created ? `<p class="note ok">기록을 만들었어요. <b>관리 링크는 다시 보여드릴 수 없으니</b> 꼭 북마크하거나 나에게 카톡으로 보내 두세요.</p>` : ""}
<p class="small"><b>공유 링크</b> — 집주인·중개사에게 보내 확인을 받으세요(보기·확인만 가능)</p>
<div class="linkbox"><input readonly value="${esc(share)}"><button class="btn ghost sm copy" data-copy="${esc(share)}">복사</button></div>
<p class="small"><b>관리 링크</b> — 나만 보관(사진 추가·삭제, 원본 받기)</p>
<div class="linkbox"><input readonly value="${esc(manage)}"><button class="btn ghost sm copy" data-copy="${esc(manage)}">복사</button></div></section>` : "";
  const cmp = compare.length ? `<section class="card"><h2>방별 비교</h2>${compare.map(([room, ins, outs]) => `<h3>${esc(room)}</h3><div class="cmp">
<div><h4>입주</h4><div class="grid">${ins.map((p) => photoCard(rec.id, p, { owner: false, afterAck: false })).join("")}</div></div>
<div><h4>퇴실</h4><div class="grid">${outs.map((p) => photoCard(rec.id, p, { owner: false, afterAck: false })).join("")}</div></div></div>`).join("")}</section>` : "";
  const danger = o.owner ? `<section class="card noprint"><h2>기록 삭제</h2><form method="post" action="/r/${esc(rec.id)}/delete" class="form">
<input type="hidden" name="key" value="${esc(o.key)}"><label><span>확인을 위해 <b>삭제</b>라고 입력해 주세요</span><input name="confirm" required></label>
<button class="btn danger">사진·확인 기록 모두 삭제</button></form></section>` : "";
  const body = `${o.err ? `<p class="note err">${esc(o.err)}</p>` : ""}${o.acked ? `<p class="note ok">확인이 기록되었습니다. 감사합니다.</p>` : ""}
<section class="card"><h1>${esc(rec.title)}</h1>${rec.note ? `<p>${esc(rec.note)}</p>` : ""}
<dl class="kv"><dt>기록 ID</dt><dd class="mono">${esc(rec.id)}</dd><dt>만든 시각</dt><dd>${kst(rec.created_at)}</dd><dt>보관 종료</dt><dd>${kst(rec.expires_at)} (${remaining(rec.expires_at)} 남음)</dd></dl>
<p class="noprint"><a class="btn ghost sm" href="/r/${esc(rec.id)}/report">인쇄용 리포트</a></p></section>
${links}${stages.map((s) => stageSection(rec.id, s, o)).join("")}${cmp}${danger}
<datalist id="rooms">${ROOMS.map((r) => `<option value="${esc(r)}">`).join("")}</datalist>`;
  return html(layout(env, {
    title: rec.title, body, scripts: ["/bang.js"],
    meta: { title: `${rec.title} — 방도장`, description: "입주·퇴실 집 상태 기록입니다. 링크를 열어 사진을 확인해 주세요." },
  }));
}

function reportView(env: Env, vm: NonNullable<Awaited<ReturnType<typeof viewModel>>>, origin: string): Response {
  const { rec, stages } = vm;
  const sec = stages.map((st) => `<h2>${st.label} 기록 (${st.photos.length}장)</h2>
${st.acks.map((a) => `<p>✅ ${esc(a.name)} (${esc(a.role)}) — ${kst(a.acked_at, true)} 확인 · 사진 ${a.photo_count}장<br><span class="mono">확인 당시 묶음 지문 ${esc(a.manifest)}</span></p>`).join("") || `<p class="muted">상대방 확인 없음</p>`}
${st.manifest ? `<p class="mono">현재 묶음 지문 ${esc(st.manifest)}</p>` : ""}
<table class="tbl"><tr><th>공간</th><th>서버 수신 시각(KST)</th><th>EXIF 촬영</th><th>원본 SHA-256</th></tr>
${st.photos.map((p) => `<tr><td>${esc(p.room)}</td><td>${kst(p.received_at, true)}</td><td>${esc(p.taken_at ?? "-")}</td><td class="mono">${esc(p.sha256)}</td></tr>`).join("")}</table>
<div class="grid">${st.photos.map((p) => photoCard(rec.id, p, { owner: false, afterAck: false })).join("")}</div>`).join("");
  return html(layout(env, {
    title: `${rec.title} 리포트`,
    body: `<section class="card"><h1>${esc(rec.title)} — 상태 기록 리포트</h1>
<dl class="kv"><dt>기록 링크</dt><dd class="mono">${esc(origin)}/r/${esc(rec.id)}</dd><dt>만든 시각</dt><dd>${kst(rec.created_at, true)}</dd><dt>출력 시각</dt><dd>${kst(now(), true)}</dd></dl>
<p class="small muted">· ‘서버 수신 시각’은 서비스 서버가 사진을 받은 시각이며, 이후 사진 파일은 바꿀 수 없습니다(원본 SHA-256으로 대조 가능).<br>· ‘EXIF 촬영’은 사진 파일에 들어 있던 값으로 참고용입니다.<br>· ‘묶음 지문’은 확인 당시 사진 목록 전체의 지문입니다. 확인 이후 사진이 바뀌면 값이 달라집니다.<br>· 본 리포트는 공증이 아니며 법적 효력을 보장하지 않습니다.</p>
<p class="noprint"><button class="btn print">인쇄 / PDF로 저장</button></p>${sec}</section>`,
    scripts: ["/bang.js"],
  }));
}

function terms(env: Env): Response {
  return html(layout(env, {
    title: "이용약관·운영정책",
    body: `<section class="card"><h1>이용약관·운영정책 (초안)</h1><p class="muted small">공개 전 법률 검토 후 확정해야 하는 초안입니다.</p>
<h2>무엇을 기록하나요</h2><p>사진 원본, 서버 수신 시각, 원본 SHA-256, (있다면) EXIF 촬영 시각, 확인자가 입력한 이름·역할과 확인 시각을 저장합니다. 회원가입은 없습니다.</p>
<h2>개인정보</h2><ul><li>원본 파일은 촬영 위치 등 메타데이터를 그대로 보관하며 기록 작성자만 내려받을 수 있습니다. 공유 화면에는 메타데이터를 제거한 사본만 보입니다.</li>
<li>남용 방지를 위해 접속 IP의 일방향 해시를 보관할 수 있습니다.</li><li>보관 기간(1~3년)이 지나면 자동 삭제되며, 작성자는 언제든 직접 삭제할 수 있습니다.</li></ul>
<h2>금지 콘텐츠</h2><p>집 상태 기록과 무관한 사진, 타인의 얼굴·개인정보가 담긴 사진, 불법촬영물 등은 금지하며 신고 시 즉시 삭제합니다.</p>
<h2>책임의 한계</h2><p>본 기록은 분쟁 시 참고 자료로 쓰일 수 있으나 공증이 아니며 법적 효력을 보장하지 않습니다.</p></section>`,
  }));
}

// ---------------- 처리 ----------------

function isImageMagic(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  const s = String.fromCharCode(...b.slice(0, 12));
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WEBP") return "image/webp";
  if (s.slice(4, 8) === "ftyp") return "image/heic";
  return null;
}

const dec = (v: string | null) => { try { return decodeURIComponent(v ?? ""); } catch { return ""; } };

async function uploadOriginal(env: Env, req: Request, rid: string, key: string | null): Promise<Response> {
  const rec = await getRec(env, rid);
  if (!rec || !(await checkKey(key, rec.owner_hash))) return json({ error: "관리 권한이 없어요." }, 403);
  const stage = req.headers.get("X-Stage") ?? "";
  const sha = (req.headers.get("X-Sha256") ?? "").toLowerCase();
  if (!STAGES[stage] || !/^[0-9a-f]{64}$/.test(sha)) return json({ error: "잘못된 요청입니다." }, 400);
  const len = Number(req.headers.get("Content-Length") ?? 0);
  if (len > MAX_ORIG) return json({ error: "파일이 너무 커요(최대 30MB)." }, 413);
  const count = (await env.DB.prepare("SELECT COUNT(*) c FROM record_photos WHERE record_id=?").bind(rid).first<{ c: number }>())?.c ?? 0;
  if (count >= Number(env.MAX_PHOTOS || 120)) return json({ error: `사진은 최대 ${env.MAX_PHOTOS}장까지예요.` }, 409);
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > MAX_ORIG) return json({ error: "파일 크기가 올바르지 않아요." }, 400);
  const mime = isImageMagic(buf);
  if (!mime) return json({ error: "이미지 파일만 올릴 수 있어요." }, 415);
  const pid = newId();
  const objKey = `r/${rid}/${pid}/orig`;
  try {
    // R2가 실제 받은 바이트의 SHA-256을 계산해 X-Sha256과 다르면 저장을 거부한다.
    await env.BUCKET.put(objKey, buf, { sha256: hexToBytes(sha), httpMetadata: { contentType: mime } });
  } catch {
    return json({ error: "전송 중 파일이 달라졌어요(지문 불일치). 다시 올려 주세요." }, 422);
  }
  await env.DB.prepare(
    "INSERT INTO record_photos(id, record_id, stage, room, orig_key, sha256, size, received_at, taken_at, orig_name) VALUES(?,?,?,?,?,?,?,?,?,?)",
  ).bind(pid, rid, stage, (dec(req.headers.get("X-Room")).trim() || "기타").slice(0, 30), objKey, sha, buf.byteLength, now(),
    dec(req.headers.get("X-Taken-At")).slice(0, 40) || null, dec(req.headers.get("X-Name")).slice(0, 120) || null).run();
  return json({ pid });
}

async function uploadDisplay(env: Env, req: Request, rid: string, pid: string, key: string | null): Promise<Response> {
  const rec = await getRec(env, rid);
  if (!rec || !(await checkKey(key, rec.owner_hash))) return json({ error: "관리 권한이 없어요." }, 403);
  const p = await env.DB.prepare("SELECT * FROM record_photos WHERE id=? AND record_id=?").bind(pid, rid).first<Photo>();
  if (!p) return json({ error: "사진을 찾을 수 없어요." }, 404);
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > MAX_DISP || isImageMagic(buf) !== "image/jpeg") return json({ error: "미리보기 형식 오류" }, 400);
  const objKey = `r/${rid}/${pid}/disp.jpg`;
  await env.BUCKET.put(objKey, buf, { httpMetadata: { contentType: "image/jpeg" } });
  await env.DB.prepare("UPDATE record_photos SET disp_key=? WHERE id=?").bind(objKey, pid).run();
  return json({ ok: true });
}

async function serveObject(env: Env, key: string | null, headers: Record<string, string> = {}): Promise<Response> {
  if (!key) return new Response("not found", { status: 404 });
  const obj = await env.BUCKET.get(key);
  if (!obj) return new Response("not found", { status: 404 });
  return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", ...headers } });
}

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const m = req.method;
  const key = url.searchParams.get("key");
  let r: RegExpMatchArray | null;

  if (path === "/" && m === "GET") return landing(env);
  if (path === "/terms") return terms(env);
  if (path === "/report") return m === "POST" ? reportSubmit(env, req) : reportPage(env, url.searchParams.get("target") ?? "");
  if (path === "/admin" && m === "GET") {
    const t = url.searchParams.get("token");
    return adminOk(env, t) ? adminPage(env, t!) : message(env, "권한 없음", "관리자 토큰이 필요합니다.", 403);
  }
  if ((path === "/admin/takedown" || path === "/admin/dismiss") && m === "POST") return adminAction(env, req, path, "r", (id) => deleteRecord(env, id));

  if (path === "/new" && m === "POST") {
    const f = await req.formData();
    const title = String(f.get("title") ?? "").trim().slice(0, 80);
    if (!title) return message(env, "기록 이름을 입력해 주세요", "예: ○○빌라 301호 입주 기록", 400, "/");
    const years = Math.min(Math.max(Number(f.get("years")) || 2, 1), 3);
    const id = newId(), k = newKey(), t = now();
    await env.DB.prepare("INSERT INTO records(id, owner_hash, title, note, created_at, expires_at) VALUES(?,?,?,?,?,?)")
      .bind(id, await sha256Hex(k), title, String(f.get("note") ?? "").trim().slice(0, 500), t, t + years * YEAR).run();
    return redirect(`/r/${id}/manage?key=${encodeURIComponent(k)}&created=1`);
  }

  if ((r = path.match(/^\/r\/([\w-]{6,20})$/)) && m === "GET") {
    const vm = await viewModel(env, r[1]);
    if (!vm) return message(env, "기록을 찾을 수 없어요", "삭제되었거나 보관 기간이 끝난 기록입니다.", 404);
    return recordPage(env, vm, url.origin, { owner: false, acked: url.searchParams.has("acked") });
  }
  if ((r = path.match(/^\/r\/([\w-]{6,20})\/manage$/)) && m === "GET") {
    const vm = await viewModel(env, r[1]);
    if (!vm) return message(env, "기록을 찾을 수 없어요", "삭제되었거나 보관 기간이 끝난 기록입니다.", 404);
    if (!(await checkKey(key, vm.rec.owner_hash))) return message(env, "관리 권한이 없어요", "관리 링크 전체를 그대로 열어 주세요.", 403);
    return recordPage(env, vm, url.origin, { owner: true, key: key!, created: url.searchParams.has("created"), err: url.searchParams.get("err") ?? "" });
  }
  if ((r = path.match(/^\/r\/([\w-]{6,20})\/report$/)) && m === "GET") {
    const vm = await viewModel(env, r[1]);
    if (!vm) return message(env, "기록을 찾을 수 없어요", "삭제되었거나 보관 기간이 끝난 기록입니다.", 404);
    return reportView(env, vm, url.origin);
  }
  if ((r = path.match(/^\/r\/([\w-]{6,20})\/orig$/)) && m === "PUT") return uploadOriginal(env, req, r[1], key);
  if ((r = path.match(/^\/r\/([\w-]{6,20})\/disp\/([\w-]{6,20})$/)) && m === "PUT") return uploadDisplay(env, req, r[1], r[2], key);
  if ((r = path.match(/^\/r\/([\w-]{6,20})\/img\/([\w-]{6,20})$/)) && m === "GET") {
    if (!(await getRec(env, r[1]))) return new Response("not found", { status: 404 });
    const p = await env.DB.prepare("SELECT disp_key FROM record_photos WHERE id=? AND record_id=?").bind(r[2], r[1]).first<{ disp_key: string | null }>();
    return serveObject(env, p?.disp_key ?? null, { "Cache-Control": "private, max-age=86400" });
  }
  if ((r = path.match(/^\/r\/([\w-]{6,20})\/orig\/([\w-]{6,20})$/)) && m === "GET") {
    const rec = await getRec(env, r[1]);
    if (!rec || !(await checkKey(key, rec.owner_hash))) return new Response("forbidden", { status: 403 });
    const p = await env.DB.prepare("SELECT orig_key, orig_name FROM record_photos WHERE id=? AND record_id=?").bind(r[2], r[1]).first<{ orig_key: string; orig_name: string | null }>();
    return serveObject(env, p?.orig_key ?? null, {
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(p?.orig_name ?? `${r[2]}.jpg`)}`, "Cache-Control": "no-store",
    });
  }
  if ((r = path.match(/^\/r\/([\w-]{6,20})\/del\/([\w-]{6,20})$/)) && m === "POST") {
    const k = String((await req.formData()).get("key") ?? "");
    const rec = await getRec(env, r[1]);
    if (!rec || !(await checkKey(k, rec.owner_hash))) return message(env, "관리 권한이 없어요", "관리 링크에서 다시 시도해 주세요.", 403);
    const p = await env.DB.prepare("SELECT * FROM record_photos WHERE id=? AND record_id=?").bind(r[2], r[1]).first<Photo>();
    const back = `/r/${r[1]}/manage?key=${encodeURIComponent(k)}`;
    if (p) {
      const acked = await env.DB.prepare("SELECT 1 FROM record_acks WHERE record_id=? AND (','||photo_ids||',') LIKE ?").bind(r[1], `%,${p.id},%`).first();
      if (acked) return message(env, "삭제할 수 없어요", "상대방이 이미 확인한 사진은 기록의 신뢰성을 위해 지울 수 없습니다.", 409, back);
      await env.BUCKET.delete([p.orig_key, p.disp_key].filter(Boolean) as string[]);
      await env.DB.prepare("DELETE FROM record_photos WHERE id=?").bind(p.id).run();
    }
    return redirect(back);
  }
  if ((r = path.match(/^\/r\/([\w-]{6,20})\/ack$/)) && m === "POST") {
    const rec = await getRec(env, r[1]);
    if (!rec) return message(env, "기록을 찾을 수 없어요", "삭제되었거나 보관 기간이 끝난 기록입니다.", 404);
    const f = await req.formData();
    const stage = String(f.get("stage") ?? "");
    const name = String(f.get("name") ?? "").trim().slice(0, 30);
    const photos = STAGES[stage] ? await getPhotos(env, r[1], stage) : [];
    if (!photos.length || !name || f.get("agree") !== "1") return message(env, "확인을 저장하지 못했어요", "이름을 입력하고 동의 항목에 체크해 주세요.", 400, `/r/${r[1]}`);
    const role = ROLES.includes(String(f.get("role"))) ? String(f.get("role")) : "기타";
    await env.DB.prepare("INSERT INTO record_acks(record_id, stage, name, role, manifest, photo_ids, photo_count, acked_at, ip_hash) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(r[1], stage, name, role, await manifestOf(photos), photos.map((p) => p.id).join(","), photos.length, now(), await ipHash(env, clientIp(req))).run();
    return redirect(`/r/${r[1]}?acked=1#stage-${stage}`);
  }
  if ((r = path.match(/^\/r\/([\w-]{6,20})\/delete$/)) && m === "POST") {
    const f = await req.formData();
    const k = String(f.get("key") ?? "");
    const rec = await getRec(env, r[1]);
    if (!rec || !(await checkKey(k, rec.owner_hash))) return message(env, "관리 권한이 없어요", "관리 링크에서 다시 시도해 주세요.", 403);
    if (f.get("confirm") !== "삭제") return message(env, "삭제하지 않았어요", "확인란에 '삭제'라고 입력해야 지워집니다.", 400, `/r/${r[1]}/manage?key=${encodeURIComponent(k)}`);
    await deleteRecord(env, r[1]);
    return message(env, "기록을 삭제했어요", "사진과 확인 기록이 모두 지워졌습니다.");
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
    const { results } = await env.DB.prepare("SELECT id FROM records WHERE expires_at<=? LIMIT 200").bind(now()).all<{ id: string }>();
    for (const r of results) await deleteRecord(env, r.id);
  },
} satisfies ExportedHandler<Env>;
