// SPDX-License-Identifier: GPL-3.0-or-later
// providers/chatgpt.js - ChatGPT (chatgpt.com) provider for Nova OP-Scripter.
// eslint-disable-next-line no-unused-vars
const NVProvider = (() => {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let diag = () => {};

  const S = {
    chatItem: "[data-message-author-role], [data-testid*='conversation-turn']",
    userRole: "user",
    assistantRole: "assistant",
    markdown: ".markdown, .prose, [class*='markdown']",
    editorSelectors: [
      "#prompt-textarea",
      '[data-testid="prompt-textarea"]',
      'div#prompt-textarea[contenteditable="true"]',
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder]',
      'div[role="textbox"][contenteditable="true"]',
      'textarea[data-id="root"]',
      'textarea[placeholder*="Message"]',
    ],
    sendBtn: 'button[data-testid="send-button"], button[aria-label*="Send"], form button[type="submit"]',
    stopBtn: 'button[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="stop"]',
    errorSurfaces: '[role="alert"], [class*="toast"], [data-testid*="error"]',
    imageThumb: "[class*='thumbnail'], img[alt*='upload'], [class*='file']",
    composer: 'form[data-type="unified-composer"], form[class*="composer"], footer form, [class*="composer"]',
  };

  const RE = {
    contextLimit: /context length|too long|maximum context|conversation is too long|message too long/i,
    tooLong: /too long|context limit|maximum length/i,
    busy: /server is busy|try again|rate limit|something went wrong/i,
    continueBtn: /^(continue|regenerate)$/i,
    stopped: /stopped|cancelled/i,
    newChat: /^(new chat|new conversation)$/i,
  };

  const timings = {
    GEN_IDLE_MS: 900,
    REASON_IDLE_MS: 8000,
    WARMUP_MS: 35000,
    REASON_NOREPLY_MS: 60000,
    STABLE_MS: 8000,
    RESPONSE_TIMEOUT_MS: 300000,
  };

  function isUserItem(item) {
    if (!item) return false;
    const role = item.getAttribute("data-message-author-role");
    if (role === S.userRole) return true;
    if (role === S.assistantRole) return false;
    const tid = item.getAttribute("data-testid") || "";
    return /user/i.test(tid);
  }
  function isAssistantItem(item) {
    if (!item) return false;
    if (item.getAttribute("data-message-author-role") === S.assistantRole) return true;
    return !isUserItem(item) && !!item.querySelector(S.markdown);
  }

  function itemText(item) {
    if (!item) return "";
    const md = item.querySelector(S.markdown);
    return (md ? md.textContent : item.textContent) || "";
  }
  function classifyText(item, excludeSel) {
    const md = item.querySelector(S.markdown);
    if (!md) return itemText(item);
    if (excludeSel && md.closest(excludeSel)) return "";
    return md.textContent || "";
  }

  function allItems() {
    const byRole = [...document.querySelectorAll("[data-message-author-role]")];
    if (byRole.length) return byRole;
    return [...document.querySelectorAll(S.chatItem)].filter((el) => el.querySelector(S.markdown) || isUserItem(el));
  }
  function assistantCount() { return allItems().filter(isAssistantItem).length; }
  function userCount() { return allItems().filter(isUserItem).length; }
  function lastAssistant() {
    const items = allItems().filter(isAssistantItem);
    return items.length ? items[items.length - 1] : null;
  }
  function lastAssistantId() {
    const a = lastAssistant();
    return a ? (a.dataset.messageId || a.id || String(allItems().indexOf(a))) : null;
  }
  function readAssistant(item) { return itemText(item || lastAssistant()); }
  function streamLen(item) { return readAssistant(item).length; }
  function snapshot() {
    return { provider: "chatgpt", assistants: assistantCount(), users: userCount() };
  }

  function getEditor() {
    for (const sel of S.editorSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    const editables = [...document.querySelectorAll('div[contenteditable="true"]')];
    return editables.find((el) => el.offsetParent !== null && el.getBoundingClientRect().height > 28) || null;
  }

  function editorText() {
    const ed = getEditor();
    if (!ed) return "";
    if (ed.tagName === "TEXTAREA") return ed.value || "";
    return ed.textContent || ed.innerText || "";
  }
  function chatIsEmpty() { return assistantCount() === 0 && userCount() === 0; }
  function isFreshChat() { return chatIsEmpty(); }
  function composerFrame() {
    const ed = getEditor();
    if (!ed) return document.querySelector(S.composer);
    return ed.closest("form") || ed.closest(S.composer) || ed.closest("footer") || ed.parentElement;
  }

  function barMount() {
    const ed = getEditor();
    if (!ed) return null;
    const send = findSendBtn();
    let box = ed.parentElement;
    while (box && box !== document.body) {
      const holdsSend = !send || box.contains(send);
      const holdsEd = box.contains(ed);
      if (holdsEd && holdsSend) break;
      box = box.parentElement;
    }
    if (!box || box === document.body) box = ed.parentElement;
    if (!box) return null;
    let before = box.firstElementChild;
    if (before && before.id === "nv-bar") before = before.nextElementSibling;
    return { parent: box, before, inside: true };
  }

  function setInputLock(on) {
    const ed = getEditor();
    if (!ed) return;
    if (ed.tagName === "TEXTAREA") ed.disabled = !!on;
    else {
      ed.setAttribute("contenteditable", on ? "false" : "true");
      if (on) ed.setAttribute("data-nv-locked", "1");
      else ed.removeAttribute("data-nv-locked");
    }
  }

  function injectProseMirror(ed, text) {
    ed.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ed);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
    const ok = document.execCommand("insertText", false, text);
    ed.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    if (!ok) {
      ed.textContent = text;
      ed.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
    }
    return true;
  }

  function setEditorText(text) {
    const ed = getEditor();
    if (!ed) return false;
    ed.focus();
    if (ed.tagName === "TEXTAREA") {
      const proto = window.HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(ed, text);
      ed.dispatchEvent(new Event("input", { bubbles: true }));
      ed.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      injectProseMirror(ed, text);
    }
    return true;
  }

  function findSendBtn() {
    const btns = [...document.querySelectorAll(S.sendBtn)];
    return btns.find((b) => b.offsetParent !== null && !b.disabled) || btns.find((b) => b.offsetParent !== null) || null;
  }
  function findStopBtn() {
    const btn = document.querySelector(S.stopBtn);
    return btn && btn.offsetParent !== null ? btn : null;
  }

  async function typeAndSend(text) {
    if (!setEditorText(text)) return false;
    await sleep(180);
    const btn = findSendBtn();
    if (btn && !btn.disabled) { btn.click(); return true; }
    const ed = getEditor();
    if (ed) {
      ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      await sleep(80);
      ed.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
      return true;
    }
    return false;
  }

  function stopGeneration() {
    const btn = findStopBtn();
    if (btn) { btn.click(); return true; }
    return false;
  }

  function isGenerating() {
    if (findStopBtn()) return true;
    const ed = getEditor();
    if (ed && ed.closest("[class*='streaming']")) return true;
    return false;
  }
  function isBusyNow() { return isGenerating(); }
  function isHardGenerating() { return !!findStopBtn(); }

  function enforceComposer() { return { ready: true }; }
  async function ensureComposerReady(reason) {
    for (let i = 0; i < 20; i++) {
      if (getEditor()) break;
      await sleep(150);
    }
    const ready = !!getEditor();
    diag("mode_ready", { reason, provider: "chatgpt", ready });
    return { ready };
  }

  function turnHalted() { return false; }
  function findContinueBtn() {
    for (const b of document.querySelectorAll("button")) {
      if (RE.continueBtn.test((b.textContent || "").trim())) return b;
    }
    return null;
  }
  function clickContinueBtn() { const b = findContinueBtn(); if (b) { b.click(); return true; } return false; }

  function scanError() {
    try {
      for (const el of document.querySelectorAll(S.errorSurfaces)) {
        if (el.offsetParent === null) continue;
        if (el.closest("[data-message-author-role]")) continue;
        const t = (el.textContent || "").trim();
        if (t.length > 8 && t.length < 600 && (RE.contextLimit.test(t) || RE.busy.test(t))) return t.slice(0, 240);
      }
    } catch {}
    if (!getEditor()) return "The input box disappeared (session ended?).";
    return null;
  }
  function isTooLongMsg(t) { return RE.tooLong.test(t || ""); }
  function isBusyMsg(t) { return RE.busy.test(t || ""); }

  function overlayBlocking() {
    const modals = document.querySelectorAll('[role="dialog"], [class*="modal"], [data-testid*="modal"]');
    for (const m of modals) {
      if (m.offsetParent === null) continue;
      const r = m.getBoundingClientRect();
      if (r.width > 200 && r.height > 120) return true;
    }
    return false;
  }

  function fileFromImage(img, i) {
    const bin = atob(img.data);
    const arr = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
    const mime = img.mimeType || "image/jpeg";
    return new File([arr], `nova-capture-${i}.${mime.includes("png") ? "png" : "jpg"}`, { type: mime });
  }
  function attachThumbs() { return [...document.querySelectorAll(S.imageThumb)]; }

  async function attachImages(images) {
    const ed = getEditor();
    if (!ed || !images || !images.length) return false;
    const before = attachThumbs().length;
    const want = before + images.length;
    const dt = new DataTransfer();
    images.forEach((img, i) => { try { dt.items.add(fileFromImage(img, i)); } catch {} });
    if (!dt.items.length) return false;
    ed.focus();
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
      try { fileInput.files = dt.files; fileInput.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
    }
    return await new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (attachThumbs().length >= want) { clearInterval(iv); resolve(true); }
        else if (Date.now() - t0 > 15000) { clearInterval(iv); resolve(attachThumbs().length > before); }
      }, 200);
    });
  }
  function clearAttachments() {}

  function openNewChat() {
    for (const b of document.querySelectorAll("a, button")) {
      const t = (b.textContent || b.getAttribute("aria-label") || "").trim();
      if (RE.newChat.test(t) || b.getAttribute("aria-label") === "New chat") { b.click(); return true; }
    }
    window.location.href = "https://chatgpt.com/";
    return true;
  }
  function conversationKey() { return location.pathname + location.search; }

  function installSendHooks() {}
  function findToolBlockSpot(item, chip) {
    const P = NVParse;
    const container = item.querySelector(S.markdown) || item;
    const kids = [...container.children];
    for (const k of kids) {
      const txt = k.textContent || "";
      if (P.CMD_KEY_RE.test(txt) || P.LUA_START_RE.test(txt)) {
        k.classList.add("nv-tool-hide");
        return { parent: k.parentElement, ref: k };
      }
    }
    return null;
  }

  return {
    id: "chatgpt",
    displayName: "ChatGPT",
    timings,
    init({ diag: d } = {}) { if (d) diag = d; },
    allItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, readAssistant,
    streamLen, snapshot, lastAssistantId,
    getEditor, editorText, chatIsEmpty, isFreshChat, composerFrame, barMount,
    setInputLock, typeAndSend, stopGeneration,
    isGenerating, isBusyNow, isHardGenerating,
    enforceComposer, ensureComposerReady,
    turnHalted, findContinueBtn, clickContinueBtn,
    scanError, isTooLongMsg, isBusyMsg, overlayBlocking,
    attachImages, clearAttachments, openNewChat, conversationKey,
    installSendHooks, findToolBlockSpot,
  };
})();
