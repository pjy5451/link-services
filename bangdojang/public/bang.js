// 방도장 클라이언트: 원본 지문 계산, EXIF 촬영시각 추출, 화면용 사본(메타데이터 제거) 생성 후 업로드
(() => {
  document.addEventListener("click", (e) => {
    const c = e.target.closest(".copy");
    if (c) {
      navigator.clipboard.writeText(c.dataset.copy).then(() => {
        c.textContent = "복사됨";
        setTimeout(() => (c.textContent = "복사"), 1500);
      });
    }
    if (e.target.closest(".print")) window.print();
  });

  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

  // JPEG EXIF에서 DateTimeOriginal(0x9003) 또는 DateTime(0x0132) 추출
  function exifDate(buf) {
    try {
      const v = new DataView(buf);
      if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
      let off = 2;
      while (off + 4 < v.byteLength) {
        const marker = v.getUint16(off);
        const size = v.getUint16(off + 2);
        if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {
          const t = off + 10;
          const le = v.getUint16(t) === 0x4949;
          const u16 = (o) => v.getUint16(t + o, le);
          const u32 = (o) => v.getUint32(t + o, le);
          const readIfd = (o) => {
            const n = u16(o), out = {};
            for (let i = 0; i < n; i++) {
              const e = o + 2 + i * 12;
              out[u16(e)] = { count: u32(e + 4), at: e + 8 };
            }
            return out;
          };
          const str = (ent) => {
            const o = ent.count > 4 ? u32(ent.at) : ent.at;
            let s = "";
            for (let i = 0; i < ent.count - 1; i++) s += String.fromCharCode(v.getUint8(t + o + i));
            return s.trim();
          };
          const ifd0 = readIfd(u32(4));
          if (ifd0[0x8769]) {
            const sub = readIfd(u32(ifd0[0x8769].at));
            if (sub[0x9003]) return str(sub[0x9003]);
          }
          return ifd0[0x0132] ? str(ifd0[0x0132]) : null;
        }
        if ((marker & 0xff00) !== 0xff00) break;
        off += 2 + size;
      }
    } catch (_) { /* EXIF 없음 */ }
    return null;
  }

  // 화면용 사본: 회전 보정 + 최대 2000px + JPEG 재인코딩(EXIF·GPS 제거)
  async function makeDisplay(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    return await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.85));
  }

  document.querySelectorAll("form.uploader").forEach((form) => {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const { rid, key, stage } = form.dataset;
      const room = form.room.value.trim() || "기타";
      const files = [...form.files.files];
      const list = form.querySelector(".progress");
      const btn = form.querySelector("button");
      if (!files.length) return;
      btn.disabled = true;
      list.innerHTML = "";
      let ok = 0;
      for (const f of files) {
        const li = document.createElement("li");
        li.textContent = `${f.name} — 지문 계산 중…`;
        list.appendChild(li);
        try {
          const buf = await f.arrayBuffer();
          const sha = hex(await crypto.subtle.digest("SHA-256", buf));
          const taken = exifDate(buf) || "";
          li.textContent = `${f.name} — 원본 올리는 중…`;
          const r1 = await fetch(`/r/${rid}/orig?key=${encodeURIComponent(key)}`, {
            method: "PUT", body: buf,
            headers: {
              "X-Stage": stage, "X-Room": encodeURIComponent(room), "X-Sha256": sha,
              "X-Taken-At": encodeURIComponent(taken), "X-Name": encodeURIComponent(f.name),
              "Content-Type": "application/octet-stream",
            },
          });
          const j1 = await r1.json();
          if (!r1.ok) throw new Error(j1.error || "업로드 실패");
          li.textContent = `${f.name} — 미리보기 만드는 중…`;
          try {
            const disp = await makeDisplay(f);
            await fetch(`/r/${rid}/disp/${j1.pid}?key=${encodeURIComponent(key)}`, { method: "PUT", body: disp, headers: { "Content-Type": "image/jpeg" } });
          } catch (_) { /* HEIC 등 브라우저가 못 여는 형식은 원본만 보관 */ }
          li.textContent = `✅ ${f.name} — 완료 (지문 ${sha.slice(0, 8)}…)`;
          ok++;
        } catch (e) {
          li.textContent = `⚠️ ${f.name} — ${e.message}`;
        }
      }
      btn.disabled = false;
      if (ok) location.href = `/r/${rid}/manage?key=${encodeURIComponent(key)}#stage-${stage}`;
    });
  });
})();
