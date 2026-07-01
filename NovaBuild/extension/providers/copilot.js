// SPDX-License-Identifier: GPL-3.0-or-later
// providers/copilot.js - Microsoft Copilot (copilot.microsoft.com) provider.
// eslint-disable-next-line no-unused-vars
const NVProvider = (() => {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let diag = () => {};

  const S = {
    chatItem: "[data-content='user-message'], [data-content='ai-message'], cib-message-group, [class*='message']",
    markdown: ".ac-textBlock, [class*='markdown'], [class*='content']",
    editorSelectors: [
      'textarea#userInput',
      'textarea[data-testid="composer-input"]',
      'cib-text-input textarea',
      'textarea[placeholder*="Message"]',
      'div[contenteditable="true"]',
    ],
    sendBtn: 'button[aria-label*="Submit"], button[aria-label*="Send"], button[data-testid*="send"]',
    stopBtn: 'button[aria-label*="Stop"]',
    errorSurfaces: '[role="alert"]',
  };

  const RE = {
    contextLimit: /context|too long|limit/i,
    tooLong: /too long/i,
    busy: /busy|try again/i,
    continueBtn: /^(continue|retry)$/i,
    newChat: /^(new chat|new topic)$/i,
  };

  const timings = {
    GEN_IDLE_MS: 900, REASON_IDLE_MS: 8000, WARMUP_MS: 30000,
    REASON_NOREPLY_MS: 60000, STABLE_MS: 8000, RESPONSE_TIMEOUT_MS: 300000,
  };

  function allItems() {
    return [...document.querySelectorAll(S.chatItem)].filter((el) => (el.textContent || "").trim().length > 5);
  }
  function isUserItem(item) {
    const dc = item.getAttribute("data-content") || "";
    return /user/i.test(dc) || /user/i.test(item.className || "");
  }
  function isAssistantItem(item) { return item && !isUserItem(item); }
  function itemText(item) {
    const md = item && item.querySelector(S.markdown);
    return (md ? md.textContent : item && item.textContent) || "";
  }
  function classifyText(item, excludeSel) {
    const md = item && item.querySelector(S.markdown);
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
    return a ? (a.id || String(allItems().indexOf(a))) : null;
  }
  function readAssistant(item) { return itemText(item || lastAssistant()); }
  function streamLen(item) { return readAssistant(item).length; }
  function snapshot() { return { provider: "copilot", assistants: assistantCount(), users: userCount() }; }

  function getEditor() {
    for (const sel of S.editorSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }
  function editorText() {
    const ed = getEditor();
    if (!ed) return "";
    return ed.tagName === "TEXTAREA" ? (ed.value || "") : (ed.textContent || "");
  }
  function chatIsEmpty() { return assistantCount() === 0 && userCount() === 0; }
  function isFreshChat() { return chatIsEmpty(); }
  function composerFrame() {
    const ed = getEditor();
    return ed ? ed.closest("form, cib-serp, footer, [class*='composer']") || ed.parentElement : null;
  }
  function barAnchor() {
    const ed = getEditor();
    if (!ed) return null;
    return ed.closest("cib-serp") || ed.closest("form") || composerFrame();
  }

  function setInputLock(on) {
    const ed = getEditor();
    if (!ed) return;
    if (ed.tagName === "TEXTAREA") ed.readOnly = !!on;
    else ed.setAttribute("contenteditable", on ? "false" : "true");
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
      document.execCommand("insertText", false, text);
      ed.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    await sleep(150);
    const btn = [...document.querySelectorAll(S.sendBtn)].find((b) => b.offsetParent && !b.disabled);
    if (btn) { btn.click(); return true; }
    ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    return true;
  }
  function stopGeneration() {
    const btn = document.querySelector(S.stopBtn);
    if (btn) { btn.click(); return true; }
    return false;
  }
  function isGenerating() { return !!document.querySelector(S.stopBtn); }
  function isBusyNow() { return isGenerating(); }
  function isHardGenerating() { return isGenerating(); }
  function enforceComposer() { return { ready: true }; }
  async function ensureComposerReady(reason) {
    for (let i = 0; i < 20; i++) { if (getEditor()) break; await sleep(200); }
    const ready = !!getEditor();
    diag("mode_ready", { reason, provider: "copilot", ready });
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
    for (const el of document.querySelectorAll(S.errorSurfaces)) {
      const t = (el.textContent || "").trim();
      if (t.length > 8 && RE.contextLimit.test(t)) return t.slice(0, 240);
    }
    return null;
  }
  function isTooLongMsg(t) { return RE.tooLong.test(t || ""); }
  function isBusyMsg(t) { return RE.busy.test(t || ""); }
  async function attachImages(images) {
    const ed = getEditor();
    if (!ed || !images || !images.length) return false;
    const dt = new DataTransfer();
    images.forEach((img, i) => {
      try {
        const bin = atob(img.data);
        const arr = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
        dt.items.add(new File([arr], `nova-${i}.jpg`, { type: img.mimeType || "image/jpeg" }));
      } catch {}
    });
    ed.focus();
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    return dt.items.length > 0;
  }
  function clearAttachments() {}
  function openNewChat() {
    window.location.href = "https://copilot.microsoft.com/";
    return true;
  }
  function conversationKey() { return location.pathname + location.search; }
  function installSendHooks() {}
  function findToolBlockSpot(item) {
    const P = NVParse;
    const container = item.querySelector(S.markdown) || item;
    for (const k of container.querySelectorAll("pre, code, p")) {
      const txt = k.textContent || "";
      if (P.CMD_KEY_RE.test(txt) || P.LUA_START_RE.test(txt)) {
        k.classList.add("nv-tool-hide");
        return { parent: k.parentElement, ref: k };
      }
    }
    return null;
  }

  return {
    id: "copilot", displayName: "Copilot", timings,
    init({ diag: d } = {}) { if (d) diag = d; },
    allItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, readAssistant, streamLen, snapshot, lastAssistantId,
    getEditor, editorText, chatIsEmpty, isFreshChat, composerFrame, barAnchor,
    setInputLock, typeAndSend, stopGeneration, isGenerating, isBusyNow, isHardGenerating,
    enforceComposer, ensureComposerReady, turnHalted, findContinueBtn, clickContinueBtn,
    scanError, isTooLongMsg, isBusyMsg, attachImages, clearAttachments, openNewChat,
    conversationKey, installSendHooks, findToolBlockSpot,
  };
})();
