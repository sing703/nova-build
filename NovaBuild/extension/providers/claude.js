// SPDX-License-Identifier: GPL-3.0-or-later
// providers/claude.js - Claude (claude.ai) provider for Nova OP-Scripter.
// eslint-disable-next-line no-unused-vars
const NVProvider = (() => {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let diag = () => {};

  const S = {
    chatItem: "[data-testid='user-message'], [data-testid='assistant-message'], .font-claude-message",
    userTestId: "user-message",
    assistantTestId: "assistant-message",
    markdown: ".font-claude-message, .prose, [class*='markdown']",
    editorSelectors: [
      'div[contenteditable="true"].ProseMirror',
      '[data-testid="composer-input"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder]',
      'div.ProseMirror',
      'textarea',
    ],
    sendBtn: 'button[aria-label*="Send"], button[data-testid="send-button"], button[type="submit"]',
    stopBtn: 'button[aria-label*="Stop"], button[data-testid="stop-button"]',
    errorSurfaces: '[role="alert"], [class*="toast"], [data-testid*="banner"]',
    imageThumb: "img[src*='blob'], [class*='attachment'], [class*='file']",
  };

  const RE = {
    contextLimit: /context|too long|limit reached|message limit/i,
    tooLong: /too long|limit reached/i,
    busy: /busy|try again|rate|overloaded/i,
    orgDisabled: /organization.{0,20}disabled|account.{0,20}disabled|access.{0,20}disabled/i,
    continueBtn: /^(continue|retry)$/i,
    stopped: /stopped|cancelled/i,
    newChat: /^(new chat|start new)$/i,
  };

  const timings = {
    GEN_IDLE_MS: 900,
    REASON_IDLE_MS: 10000,
    WARMUP_MS: 35000,
    REASON_NOREPLY_MS: 70000,
    STABLE_MS: 9000,
    RESPONSE_TIMEOUT_MS: 300000,
  };

  function isUserItem(item) {
    if (!item) return false;
    const tid = item.getAttribute("data-testid") || "";
    if (tid === S.userTestId) return true;
    return /user/i.test(item.className || "") && !/assistant/i.test(item.className || "");
  }
  function isAssistantItem(item) {
    if (!item) return false;
    const tid = item.getAttribute("data-testid") || "";
    if (tid === S.assistantTestId) return true;
    return !isUserItem(item) && !!item.querySelector(S.markdown);
  }

  function allItems() {
    const a = [...document.querySelectorAll("[data-testid='user-message'], [data-testid='assistant-message']")];
    if (a.length) return a;
    return [...document.querySelectorAll(S.chatItem)].filter((el) => el.querySelector(S.markdown) || isUserItem(el));
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
  function snapshot() { return { provider: "claude", assistants: assistantCount(), users: userCount() }; }

  function getEditor() {
    for (const sel of S.editorSelectors) {
      const eds = [...document.querySelectorAll(sel)];
      const vis = eds.find((e) => e.offsetParent !== null && !e.closest("[data-nv-locked]"));
      if (vis) return vis;
    }
    return null;
  }
  function editorText() {
    const ed = getEditor();
    return ed ? (ed.textContent || ed.innerText || ed.value || "") : "";
  }
  function chatIsEmpty() { return assistantCount() === 0 && userCount() <= 1; }
  function isFreshChat() { return chatIsEmpty(); }
  function composerFrame() {
    const ed = getEditor();
    return ed ? ed.closest("form, footer, [class*='composer']") || ed.parentElement : null;
  }

  function barAnchor() {
    const ed = getEditor();
    if (!ed) return null;
    let n = ed;
    for (let i = 0; i < 12 && n; i++) {
      const r = n.getBoundingClientRect();
      if (r.width > 200 && (n.tagName === "FORM" || [...n.classList].some((c) => /composer|input|footer/i.test(c)))) return n;
      n = n.parentElement;
    }
    return ed.closest("form") || composerFrame();
  }

  function setInputLock(on) {
    const ed = getEditor();
    if (!ed) return;
    if (ed.tagName === "TEXTAREA") ed.readOnly = !!on;
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
  }

  async function typeAndSend(text) {
    const ed = getEditor();
    if (!ed) return false;
    ed.focus();
    if (ed.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ed, text);
      ed.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      injectProseMirror(ed, text);
    }
    await sleep(180);
    const send = [...document.querySelectorAll(S.sendBtn)].find((b) => b.offsetParent !== null && !b.disabled);
    if (send) { send.click(); return true; }
    ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    return true;
  }

  function stopGeneration() {
    const btn = document.querySelector(S.stopBtn);
    if (btn && btn.offsetParent !== null) { btn.click(); return true; }
    return false;
  }
  function isGenerating() { return !!document.querySelector(S.stopBtn + ":not([hidden])") || isHardGenerating(); }
  function isBusyNow() { return isGenerating(); }
  function isHardGenerating() {
    const btn = document.querySelector(S.stopBtn);
    if (btn && btn.offsetParent !== null) return true;
    const ed = getEditor();
    return ed && ed.closest("[class*='streaming']") != null;
  }

  function enforceComposer() { return { ready: true }; }
  async function ensureComposerReady(reason) {
    for (let i = 0; i < 20; i++) {
      if (getEditor()) break;
      await sleep(150);
    }
    const orgErr = detectOrgDisabled();
    const ready = !!getEditor() && !orgErr;
    diag("mode_ready", { reason, provider: "claude", ready, orgErr: !!orgErr });
    return { ready, orgErr };
  }

  function detectOrgDisabled() {
    for (const el of document.querySelectorAll(S.errorSurfaces + ", body *")) {
      if (el.children.length > 8) continue;
      const t = (el.textContent || "").trim();
      if (t.length > 10 && t.length < 400 && RE.orgDisabled.test(t)) return t.slice(0, 200);
    }
    return null;
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
    const org = detectOrgDisabled();
    if (org) return null;
    try {
      for (const el of document.querySelectorAll(S.errorSurfaces)) {
        if (el.offsetParent === null) continue;
        if (el.closest("[data-testid='user-message'], [data-testid='assistant-message']")) continue;
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
    const org = detectOrgDisabled();
    if (org) return true;
    const modals = document.querySelectorAll('[role="dialog"], [class*="modal"]');
    for (const m of modals) {
      if (m.offsetParent === null) continue;
      const r = m.getBoundingClientRect();
      if (r.width > 200 && r.height > 100) return true;
    }
    return false;
  }

  function fileFromImage(img, i) {
    const bin = atob(img.data);
    const arr = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
    const mime = img.mimeType || "image/jpeg";
    return new File([arr], `nova-capture-${i}.jpg`, { type: mime });
  }

  async function attachImages(images) {
    const ed = getEditor();
    if (!ed || !images || !images.length) return false;
    const dt = new DataTransfer();
    images.forEach((img, i) => { try { dt.items.add(fileFromImage(img, i)); } catch {} });
    ed.focus();
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
      try { fileInput.files = dt.files; fileInput.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
    }
    await sleep(400);
    return dt.items.length > 0;
  }
  function clearAttachments() {}

  function openNewChat() {
    for (const b of document.querySelectorAll("a, button")) {
      const label = (b.textContent || b.getAttribute("aria-label") || "").trim();
      if (RE.newChat.test(label) || /new chat/i.test(label)) { b.click(); return true; }
    }
    window.location.href = "https://claude.ai/new";
    return true;
  }
  function conversationKey() { return location.pathname; }
  function installSendHooks() {}

  function findToolBlockSpot(item, chip) {
    const P = NVParse;
    const container = item.querySelector(S.markdown) || item;
    for (const k of container.querySelectorAll("pre, code, p, div")) {
      const txt = k.textContent || "";
      if (P.CMD_KEY_RE.test(txt) || P.LUA_START_RE.test(txt)) {
        k.classList.add("nv-tool-hide");
        return { parent: k.parentElement, ref: k };
      }
    }
    return null;
  }

  return {
    id: "claude",
    displayName: "Claude",
    timings,
    init({ diag: d } = {}) { if (d) diag = d; },
    allItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, readAssistant,
    streamLen, snapshot, lastAssistantId,
    getEditor, editorText, chatIsEmpty, isFreshChat, composerFrame, barAnchor,
    setInputLock, typeAndSend, stopGeneration,
    isGenerating, isBusyNow, isHardGenerating,
    enforceComposer, ensureComposerReady,
    turnHalted, findContinueBtn, clickContinueBtn,
    scanError, isTooLongMsg, isBusyMsg, overlayBlocking,
    attachImages, clearAttachments, openNewChat, conversationKey,
    installSendHooks, findToolBlockSpot,
  };
})();
