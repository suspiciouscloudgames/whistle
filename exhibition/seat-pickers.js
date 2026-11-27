(() => {
  if (window !== top) return;
  let popup, filesToken;
  const button = (label, action) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label;
    b.style.cssText = "min-height:38px;border:1px solid #bbb;margin:3px;padding:5px 12px;background:white;color:black";
    b.onclick = action;
    return b;
  };
  const close = () => { if (popup) popup.close(); };
  function open(title, cancel) {
    close();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label",title);
    dialog.style.cssText = "padding:16px;width:min(480px,90vw);max-height:80vh;overflow:auto;background:white;color:#111;border:1px solid #333";
    const header = document.createElement("header");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;overflow-wrap:anywhere";
    const heading = document.createElement("strong"); heading.textContent = title;
    header.append(heading,button("닫기",() => { cancel?.(); dialog.close(); }));
    dialog.append(header);
    dialog.addEventListener("cancel", () => cancel?.());
    dialog.addEventListener("close", () => { dialog.remove(); if (popup === dialog) popup = null; });
    document.body.append(dialog);
    dialog.showModal();
    popup = dialog;
    return dialog;
  }
  chrome.webview.addEventListener("message", ({data}) => {
    if (data?.type === "files-done") { close(); return; }
    if (data?.type === "files-error") { if (popup) popup.append(document.createTextNode(data.error)); return; }
    if (data?.type !== "files") return;
    filesToken = data.token;
    const send = id => chrome.webview.postMessage("file|" + filesToken + "|" + id);
    const dialog = open("파일 선택", () => send("cancel"));
    const address = document.createElement("p"); address.textContent = data.folder; dialog.append(address);
    if (data.folder !== "위치") dialog.append(button("상위 폴더",() => send("up")));
    if (data.error) { const msg = document.createElement("p"); msg.textContent = data.error; dialog.append(msg); }
    for (const item of data.items) {
      const option = button((item.directory ? "▸ " : "") + item.label,() => send(item.id));
      option.style.cssText += ";display:block;width:100%;text-align:left;overflow-wrap:anywhere";
      dialog.append(option);
    }
  });
  // Native system popups would follow the single desktop pointer.
  document.addEventListener("mousedown",event => {
    if (event.button !== 0 || !(event.target instanceof HTMLSelectElement) || event.target.disabled) return;
    event.preventDefault();
    const select = event.target, dialog = open(select.getAttribute("aria-label") || "선택");
    for (const option of select.options) {
      const choice = button(option.text,() => {
        select.value = option.value;
        select.dispatchEvent(new Event("change",{bubbles:true}));
        dialog.close();
      });
      choice.disabled = option.disabled; choice.setAttribute("aria-pressed",String(option.selected)); dialog.append(choice);
    }
  },true);
  document.addEventListener("click",event => {
    if (!(event.target instanceof HTMLInputElement) || event.target.type !== "color" || event.target.disabled) return;
    event.preventDefault();
    const input = event.target, dialog = open("색 선택");
    const value = input.value.slice(1);
    const parts = [0,2,4].map(i => parseInt(value.slice(i,i + 2),16));
    const swatch = document.createElement("div");
    swatch.style.cssText = "height:36px;border:1px solid #999;background:" + input.value;
    dialog.append(swatch);
    for (const [i,name] of ["빨강","초록","파랑"].entries()) {
      const row = document.createElement("label"); row.textContent = name;
      row.style.cssText = "display:flex;gap:12px;align-items:center;margin:12px 0";
      const range = document.createElement("input"); range.type = "range"; range.min = 0; range.max = 255; range.value = parts[i];
      range.oninput = () => { parts[i] = Number(range.value); swatch.style.background = color(); };
      row.append(range); dialog.append(row);
    }
    function color() { return "#" + parts.map(n=>n.toString(16).padStart(2,"0")).join(""); }
    dialog.append(button("적용",() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,color());
      input.dispatchEvent(new Event("input",{bubbles:true}));
      input.dispatchEvent(new Event("change",{bubbles:true}));
      dialog.close();
    }));
  },true);
})();
