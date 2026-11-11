// 그때열기 클라이언트: 사진 재인코딩(메타데이터 제거) 후 생성, 카운트다운
(() => {
  const $ = (s) => document.querySelector(s);

  document.addEventListener("click", (e) => {
    const c = e.target.closest(".copy");
    if (!c) return;
    const text = c.dataset.copy || (c.previousElementSibling && c.previousElementSibling.value) || "";
    navigator.clipboard.writeText(text).then(() => {
      c.textContent = "복사됨";
      setTimeout(() => (c.textContent = "복사"), 1500);
    });
  });

  // 기본값: 다음 날 0시
  const openInput = document.querySelector("input[name=open_at]");
  if (openInput && !openInput.value) {
    const d = new Date(Date.now() + 9 * 3600 * 1000); // KST 기준 날짜
    d.setUTCDate(d.getUTCDate() + 1);
    openInput.value = `${d.toISOString().slice(0, 10)}T00:00`;
  }

  async function reencode(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * scale);
    cv.height = Math.round(bmp.height * scale);
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    return await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.88));
  }

  const form = $("#capform");
  if (form) {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const st = $("#capstatus"), btn = form.querySelector("button");
      btn.disabled = true;
      st.textContent = "만드는 중…";
      try {
        const fd = new FormData();
        for (const n of ["sender", "teaser", "message", "open_at", "close_after"]) fd.append(n, form[n].value);
        const file = form.photo.files[0];
        if (file) {
          st.textContent = "사진 정리 중… (위치 정보 등 제거)";
          fd.append("photo", await reencode(file), "photo.jpg");
        }
        const r = await fetch("/api/create", { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "만들지 못했어요.");
        $("#share").value = j.url;
        $("#manage").value = j.manage;
        $("#capwhen").textContent = `${j.opens}에 열리고, ${j.closes}에 사라져요. (한국 시간)`;
        $("#creator").classList.add("hidden");
        $("#capresult").classList.remove("hidden");
      } catch (e) {
        st.textContent = "⚠️ " + e.message;
        btn.disabled = false;
      }
    });
  }

  const cd = $("#countdown");
  if (cd) {
    const openAt = Number(cd.dataset.open) * 1000;
    const skew = Number(cd.dataset.now) * 1000 - Date.now(); // 기기 시계 오차 보정(서버 기준)
    const pad = (n) => String(n).padStart(2, "0");
    const tick = () => {
      const left = Math.max(0, openAt - (Date.now() + skew));
      const s = Math.floor(left / 1000);
      const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      cd.textContent = (d ? `${d}일 ` : "") + `${pad(h)}:${pad(m)}:${pad(sec)}`;
      if (left <= 0) setTimeout(() => location.reload(), 800);
      else setTimeout(tick, 1000);
    };
    tick();
  }
})();
