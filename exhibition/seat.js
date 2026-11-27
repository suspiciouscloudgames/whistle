(() => {
  if (window !== top) return;
  const initialize = () => {
    const cursor = document.createElement("div");
    cursor.setAttribute("aria-hidden", "true");
    cursor.style.cssText = "pointer-events:none;position:fixed;inset:0 auto auto 0;margin:0;border:0;background:transparent;overflow:visible;width:20px;height:26px;z-index:2147483647";
    cursor.innerHTML = '<svg viewBox="0 0 20 26" width="20" height="26"><path d="M2 1.5v20l5-5 4 8 3-1.5-4-8h7Z" fill="white" stroke="black" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    cursor.style.transform = 'translate(' + innerWidth/2 + 'px,' + innerHeight/2 + 'px)';
    const prompt = document.createElement("div");
    prompt.style.cssText = "position:fixed;inset:0;place-items:center;background:#151515;color:white;text-align:center;white-space:pre-line;font:500 24px/1.8 Pretendard,sans-serif;z-index:2147483645;display:none";
    document.body.append(prompt);
    const surface = () => {
      const modals = [...document.querySelectorAll("dialog[open]")];
      return modals[modals.length - 1] || document.body;
    };
    cursor.popover = "manual";
    document.body.append(cursor);
    cursor.showPopover();
    // A newly opened modal enters the top layer above previous popovers.
    new MutationObserver(() => { cursor.hidePopover(); cursor.showPopover(); })
      .observe(document.body, {attributes:true, attributeFilter:["open"], subtree:true});
    function point(e) {
      cursor.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
    }
    document.addEventListener("pointermove", point, true);
    document.addEventListener("pointerdown", point, true);
    let holding;
    const stop = () => clearTimeout(holding);
    const corner = e => e.clientX <= 45 && e.clientY <= 45;
    document.addEventListener("pointerdown", e => {
      if (e.button === 0 && corner(e)) holding = setTimeout(() => chrome.webview.postMessage("operator"), 3000);
    }, true);
    document.addEventListener("pointermove", e => { if (!corner(e)) stop(); }, true);
    document.addEventListener("pointerup", stop, true);
    document.addEventListener("pointercancel", stop, true);
    chrome.webview.addEventListener("message", ({data}) => {
      if (typeof data !== "string") return;
      prompt.textContent = data;
      prompt.style.display = data ? "grid" : "none";
    });
    installKeyboard(surface);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, {once:true});
  else initialize();

  function installKeyboard(surface) {
    const panel = document.createElement("div");
    panel.setAttribute("aria-label","화면 키보드");
    panel.style.cssText = "position:fixed;z-index:2147483646;bottom:8px;left:50%;transform:translateX(-50%);padding:6px;background:#eee;color:#111;border:1px solid #555;border-radius:6px;box-shadow:0 2px 14px #0004;width:min(500px,95vw)";
    panel.onpointerdown = event => event.preventDefault();
    let target, korean = true, shift = false, jamo = [], start = 0, end = 0;
    const reset = () => { jamo = []; };
    const hide = () => { panel.remove(); target = null; reset(); };
    function replace(text, left, right) {
      const value = target.value.slice(0,left) + text + target.value.slice(right);
      const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,"value").set.call(target,value);
      target.setSelectionRange(left + text.length,left + text.length);
      target.dispatchEvent(new Event("input",{bubbles:true}));
    }
    function type(key) {
      if (!target?.isConnected) { hide(); return; }
      if (key === "닫기") { hide(); return; }
      if (key === "한/영") { korean = !korean; reset(); draw(); return; }
      if (key === "⇧") { shift = !shift; draw(); return; }
      const left = target.selectionStart, right = target.selectionEnd;
      if (jamo.length && (left !== end || right !== end)) reset();
      if (key === "⌫" && jamo.length) jamo.pop();
      else if (korean && /^[ㄱ-ㅎㅏ-ㅣ]$/.test(key)) {
        if (!jamo.length) { start = left; end = right; }
        jamo.push(key);
      } else {
        reset();
        if (key === "⌫") replace("",left === right ? Math.max(0,left-1) : left,right);
        else replace(key === "공백" ? " " : key,left,right);
        if (shift) { shift = false; draw(); }
        return;
      }
      const word = Hangul.assemble(jamo);
      replace(word,start,end);
      end = start + word.length;
      if (shift) { shift = false; draw(); }
    }
    function draw() {
      const rows = korean
        ? [shift ? "!@#$%^&*()" : "1234567890",shift ? "ㅃㅉㄸㄲㅆㅛㅕㅑㅒㅖ" : "ㅂㅈㄷㄱㅅㅛㅕㅑㅐㅔ","ㅁㄴㅇㄹㅎㅗㅓㅏㅣ","ㅋㅌㅊㅍㅠㅜㅡ,.?"]
        : [shift ? "!@#$%^&*()" : "1234567890","qwertyuiop","asdfghjkl","zxcvbnm,.?"].map(row => shift ? row.toUpperCase() : row);
      panel.replaceChildren();
      for (const keys of [...rows,["⇧","한/영","공백","⌫","닫기"]]) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:3px;margin:2px";
        for (const key of keys) {
          const button = document.createElement("button");
          button.type = "button"; button.tabIndex = -1; button.textContent = key;
          button.style.cssText = "flex:1;min-width:0;height:34px;margin:0;padding:0;background:white;color:black;border:1px solid #999;border-radius:3px;font:16px sans-serif";
          button.onclick = () => type(key);
          row.append(button);
        }
        panel.append(row);
      }
    }
    document.addEventListener("click", e => {
      if (panel.contains(e.target)) return;
      const field = e.target.closest('textarea,input:not([type]),input[type=text],input[type=search]');
      if (!field || field.readOnly || field.disabled) { hide(); return; }
      target = field; reset(); draw(); surface().append(panel);
      const below = field.getBoundingClientRect().bottom > innerHeight * 0.60;
      panel.style.top = below ? "8px" : "auto"; panel.style.bottom = below ? "auto" : "8px";
    }, true);
    document.addEventListener("close", hide, true);
  }
})();
