// 한번봄 클라이언트: 업로드 전 재인코딩(메타데이터 제거), 열람 시 캔버스에 워터마크와 함께 그리기
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

  // ---------- 업로드 ----------
  const up = $("#upform");
  if (up) {
    up.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const st = $("#upstatus"), btn = up.querySelector("button");
      const file = up.file.files[0];
      if (!file) return;
      btn.disabled = true;
      st.textContent = "사진 정리 중… (위치 정보 등 제거)";
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
        const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(bmp.width * scale);
        cv.height = Math.round(bmp.height * scale);
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
        const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.9));
        st.textContent = "올리는 중…";
        const r = await fetch("/api/upload", {
          method: "PUT", body: blob,
          headers: {
            "Content-Type": "image/jpeg",
            "X-Expire": up.expire.value, "X-Max-Views": up.views.value,
            "X-Password": encodeURIComponent(up.password.value),
            "X-Wm-Ip": up.wm_ip.checked ? "1" : "0",
            "X-Wm-Text": encodeURIComponent(up.wm_text.value),
          },
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "업로드 실패");
        $("#share").value = j.url;
        $("#manage").value = j.manage;
        $("#manageGo").href = j.manage;
        $("#uploader").classList.add("hidden");
        $("#result").classList.remove("hidden");
      } catch (e) {
        st.textContent = "⚠️ " + (e.message || "이 사진은 열 수 없어요. 다른 형식으로 시도해 주세요.");
        btn.disabled = false;
      }
    });
  }

  // ---------- 열람 ----------
  const gate = $("#gate");
  if (gate) {
    const form = $("#openform");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const st = $("#openstatus"), btn = form.querySelector("button");
      btn.disabled = true;
      st.textContent = "여는 중…";
      try {
        const r = await fetch(`/v/${gate.dataset.id}/open`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: form.password ? form.password.value : "" }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "열 수 없어요.");
        const img = await fetch(j.img, { cache: "no-store" });
        if (!img.ok) throw new Error("사진을 불러오지 못했어요.");
        const bmp = await createImageBitmap(await img.blob());
        draw(bmp, j.wm);
        gate.classList.add("hidden");
        $("#viewer").classList.remove("hidden");
        $("#viewinfo").textContent = j.left === null
          ? `${j.expires}까지 볼 수 있어요.`
          : j.left > 0 ? `${j.left}번 더 볼 수 있어요 · ${j.expires} 자동 삭제` : "이번이 마지막 열람이에요. 이 화면을 닫으면 다시 볼 수 없어요.";
      } catch (e) {
        st.textContent = "⚠️ " + e.message;
        btn.disabled = false;
        if (/사라진/.test(e.message)) setTimeout(() => location.reload(), 1200);
      }
    });
  }

  function draw(bmp, lines) {
    const cv = $("#cv");
    cv.width = bmp.width;
    cv.height = bmp.height;
    const ctx = cv.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    bmp.close && bmp.close();
    const text = (lines || []).join("   ·   ");
    if (text) {
      const size = Math.max(14, Math.round(Math.min(cv.width, cv.height) / 26));
      ctx.save();
      ctx.font = `600 ${size}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.38)";
      ctx.strokeStyle = "rgba(0,0,0,0.28)";
      ctx.lineWidth = Math.max(1, size / 12);
      const diag = Math.hypot(cv.width, cv.height);
      ctx.translate(cv.width / 2, cv.height / 2);
      ctx.rotate(-Math.PI / 6);
      const tw = ctx.measureText(text).width + size * 3;
      let row = 0;
      for (let y = -diag / 2; y < diag / 2; y += size * 4) {
        const off = (row++ % 2) * (tw / 2);
        for (let x = -diag / 2 - tw; x < diag / 2; x += tw) {
          ctx.strokeText(text, x + off, y);
          ctx.fillText(text, x + off, y);
        }
      }
      ctx.restore();
    }
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    cv.addEventListener("dragstart", (e) => e.preventDefault());
  }
})();
