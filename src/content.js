(function () {
  "use strict";

  const TARGET_PATH = "/ai-tool/generate";
  const ROOT_ID = "jm-floating-composer-root";
  const COLLAPSED_CLASS = "jm-floating-composer--collapsed";
  const BATCH_SEND_INTERVAL_MS = 1500;
  const DB_NAME = "jm-floating-composer-db";
  const STORE_NAME = "composer_state";
  const STATE_KEY = "default";
  const STATUS = {
    READY: "ready",
    MISSING: "missing",
    ERROR: "error",
    SENDING: "sending"
  };

  const state = {
    adapterStatus: STATUS.MISSING,
    dynamicTemplateText: "",
    dynamicEnabled: false,
    prefixEnabled: false,
    prefixText: "",
    draftText: "",
    draftSelectionStart: null,
    draftSelectionEnd: null,
    suffixEnabled: false,
    suffixText: "",
    isSending: false,
    collapsed: false,
    hydrated: false,
    lastStatusText: "未找到官方输入框"
  };

  const ui = {
    root: null,
    shell: null,
    expanded: null,
    collapsed: null,
    dynamicSection: null,
    dynamicToggle: null,
    dynamicTextarea: null,
    prefixSection: null,
    prefixToggle: null,
    prefixTextarea: null,
    textarea: null,
    suffixSection: null,
    suffixToggle: null,
    suffixTextarea: null,
    sendButton: null,
    status: null,
    composeHint: null,
    toggleButton: null,
    expandButton: null
  };

  let observer = null;
  let refreshTimer = null;
  let persistTimer = null;
  let dbPromise = null;

  if (!isTargetPage()) {
    return;
  }

  void boot();

  async function boot() {
    mountFloatingComposer();
    await hydratePersistedState();
    refreshAdapterStatus();
    observer = new MutationObserver(() => {
      scheduleAdapterRefresh();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "disabled", "aria-disabled"]
    });
    window.addEventListener("beforeunload", cleanup, { once: true });
  }

  function cleanup() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (persistTimer) {
      window.clearTimeout(persistTimer);
      persistTimer = null;
    }
  }

  function isTargetPage() {
    return window.location.pathname.startsWith(TARGET_PATH);
  }

  function mountFloatingComposer() {
    if (document.getElementById(ROOT_ID)) {
      return;
    }

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "jm-floating-composer";
    root.innerHTML = [
      '<div class="jm-floating-composer__expanded">',
      '  <div class="jm-floating-composer__header">',
      '    <div class="jm-floating-composer__title-wrap">',
      '      <div class="jm-floating-composer__title">即梦浮动输入框</div>',
      '      <div class="jm-floating-composer__subtitle">Enter 发送，Shift+Enter 换行</div>',
      "    </div>",
      '    <button class="jm-floating-composer__icon-btn" type="button" aria-label="折叠">−</button>',
      "  </div>",
      '  <div class="jm-floating-composer__stack">',
      '    <div class="jm-floating-composer__section jm-floating-composer__section--dynamic">',
      '      <span class="jm-floating-composer__field-head">',
      '        <span class="jm-floating-composer__label jm-floating-composer__label--inline">动态提示词</span>',
      '        <button id="jm-floating-composer-dynamic-toggle" class="jm-floating-composer__mini-btn" type="button">开启</button>',
      "      </span>",
      '      <div class="jm-floating-composer__section-body">',
      '        <textarea id="jm-floating-composer-dynamic" class="jm-floating-composer__textarea jm-floating-composer__textarea--aux jm-floating-composer__textarea--config" rows="3" placeholder="支持这些格式：&#10;&quot;角色&quot;:[&quot;赛博武士&quot;]&#10;&quot;风格&quot;:[&quot;财阀&quot;,&quot;时尚&quot;,&quot;校园&quot;]&#10;{&quot;角色&quot;:[&quot;赛博武士&quot;],&quot;风格&quot;:[&quot;财阀&quot;,&quot;时尚&quot;]}"></textarea>',
      '        <span class="jm-floating-composer__help">支持单行逗号拼接、逐行输入和外层对象包裹；键值仍必须是 &quot;key&quot;:[&quot;val&quot;] 这种格式，多值会按位置配对循环发送</span>',
      "      </div>",
      "    </div>",
      '    <div class="jm-floating-composer__section jm-floating-composer__section--prefix">',
      '      <span class="jm-floating-composer__field-head">',
      '        <span class="jm-floating-composer__label jm-floating-composer__label--inline">前缀提示词</span>',
      '        <button id="jm-floating-composer-prefix-toggle" class="jm-floating-composer__mini-btn" type="button">开启</button>',
      "      </span>",
      '      <div class="jm-floating-composer__section-body">',
      '        <textarea id="jm-floating-composer-prefix" class="jm-floating-composer__textarea jm-floating-composer__textarea--aux" rows="2" placeholder="例如：{{前缀}}"></textarea>',
      "      </div>",
      "    </div>",
      '    <label class="jm-floating-composer__field" for="jm-floating-composer-textarea">',
      '      <span class="jm-floating-composer__label">用户输入</span>',
      '      <textarea id="jm-floating-composer-textarea" class="jm-floating-composer__textarea" rows="5" placeholder="在这里输入提示词，发送时会写入即梦官方输入框"></textarea>',
      "    </label>",
      '    <div class="jm-floating-composer__section jm-floating-composer__section--suffix">',
      '      <span class="jm-floating-composer__field-head">',
      '        <span class="jm-floating-composer__label jm-floating-composer__label--inline">后缀提示词</span>',
      '        <button id="jm-floating-composer-suffix-toggle" class="jm-floating-composer__mini-btn" type="button">开启</button>',
      "      </span>",
      '      <div class="jm-floating-composer__section-body">',
      '        <textarea id="jm-floating-composer-suffix" class="jm-floating-composer__textarea jm-floating-composer__textarea--aux" rows="2" placeholder="例如：{{后缀}}"></textarea>',
      "      </div>",
      "    </div>",
      '    <div class="jm-floating-composer__warning" hidden></div>',
      '    <div class="jm-floating-composer__compose-hint">发送时会拼接为：前缀 + 用户输入 + 后缀</div>',
      "  </div>",
      '  <div class="jm-floating-composer__footer">',
      '    <div class="jm-floating-composer__status" data-status="missing">未找到官方输入框</div>',
      '    <button class="jm-floating-composer__send" type="button">发送</button>',
      "  </div>",
      "</div>",
      '<button class="jm-floating-composer__collapsed" type="button" aria-label="展开浮动输入框">即梦输入</button>'
    ].join("");

    document.body.appendChild(root);

    ui.root = root;
    ui.expanded = root.querySelector(".jm-floating-composer__expanded");
    ui.collapsed = root.querySelector(".jm-floating-composer__collapsed");
    ui.dynamicSection = root.querySelector(".jm-floating-composer__section--dynamic");
    ui.dynamicToggle = root.querySelector("#jm-floating-composer-dynamic-toggle");
    ui.dynamicTextarea = root.querySelector("#jm-floating-composer-dynamic");
    ui.prefixSection = root.querySelector(".jm-floating-composer__section--prefix");
    ui.prefixToggle = root.querySelector("#jm-floating-composer-prefix-toggle");
    ui.prefixTextarea = root.querySelector("#jm-floating-composer-prefix");
    ui.textarea = root.querySelector("#jm-floating-composer-textarea");
    ui.suffixSection = root.querySelector(".jm-floating-composer__section--suffix");
    ui.suffixToggle = root.querySelector("#jm-floating-composer-suffix-toggle");
    ui.suffixTextarea = root.querySelector("#jm-floating-composer-suffix");
    ui.sendButton = root.querySelector(".jm-floating-composer__send");
    ui.status = root.querySelector(".jm-floating-composer__status");
    ui.warning = root.querySelector(".jm-floating-composer__warning");
    ui.composeHint = root.querySelector(".jm-floating-composer__compose-hint");
    ui.toggleButton = root.querySelector(".jm-floating-composer__icon-btn");
    ui.expandButton = root.querySelector(".jm-floating-composer__collapsed");

    ui.dynamicToggle.addEventListener("click", onDynamicToggleClick);
    ui.dynamicTextarea.addEventListener("input", onDynamicTemplateInput);
    ui.prefixToggle.addEventListener("click", onPrefixToggleClick);
    ui.prefixTextarea.addEventListener("input", onPrefixInput);
    ui.textarea.addEventListener("input", onDraftInput);
    ui.textarea.addEventListener("click", onDraftSelectionChange);
    ui.textarea.addEventListener("keydown", onTextareaKeyDown);
    ui.textarea.addEventListener("keyup", onDraftSelectionChange);
    ui.textarea.addEventListener("select", onDraftSelectionChange);
    ui.textarea.addEventListener("focus", onDraftSelectionChange);
    ui.suffixToggle.addEventListener("click", onSuffixToggleClick);
    ui.suffixTextarea.addEventListener("input", onSuffixInput);
    ui.sendButton.addEventListener("click", onSendClick);
    ui.toggleButton.addEventListener("click", () => setCollapsed(true));
    ui.expandButton.addEventListener("click", () => setCollapsed(false));

    syncUIState();
  }

  function onDynamicToggleClick(event) {
    event.preventDefault();
    state.dynamicEnabled = !state.dynamicEnabled;
    syncUIState();
  }

  function onDynamicTemplateInput(event) {
    state.dynamicTemplateText = event.target.value;
    syncUIState();
  }

  function onPrefixToggleClick(event) {
    event.preventDefault();
    state.prefixEnabled = !state.prefixEnabled;
    syncUIState();
  }

  function onPrefixInput(event) {
    state.prefixText = event.target.value;
    syncUIState();
  }

  function onDraftInput(event) {
    state.draftText = event.target.value;
    updateDraftSelection(event.target);
    syncUIState();
  }

  function onDraftSelectionChange(event) {
    updateDraftSelection(event.target);
  }

  function onSuffixToggleClick(event) {
    event.preventDefault();
    state.suffixEnabled = !state.suffixEnabled;
    syncUIState();
  }

  function onSuffixInput(event) {
    state.suffixText = event.target.value;
    syncUIState();
  }

  function onTextareaKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendDraft();
      return;
    }

    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.isComposing
    ) {
      const deleted = deleteDraftPlaceholderRange(event.key, event.target);
      if (deleted) {
        event.preventDefault();
      }
    }
  }

  function onSendClick() {
    void sendDraft();
  }

  function updateDraftSelection(textarea) {
    if (!textarea) {
      return;
    }

    state.draftSelectionStart =
      typeof textarea.selectionStart === "number" ? textarea.selectionStart : null;
    state.draftSelectionEnd =
      typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : state.draftSelectionStart;
  }

  function getDraftSelection(value, textarea) {
    const fallback = value.length;
    const activeStart =
      textarea && document.activeElement === textarea && typeof textarea.selectionStart === "number"
        ? textarea.selectionStart
        : null;
    const activeEnd =
      textarea && document.activeElement === textarea && typeof textarea.selectionEnd === "number"
        ? textarea.selectionEnd
        : null;

    const rawStart = activeStart ?? state.draftSelectionStart ?? fallback;
    const rawEnd = activeEnd ?? state.draftSelectionEnd ?? rawStart;
    const start = Math.max(0, Math.min(rawStart, value.length));
    const end = Math.max(start, Math.min(rawEnd, value.length));

    return { start, end };
  }

  function getDraftPlaceholderRanges(value) {
    const ranges = [];
    const pattern = /\{\{[^{}]+?\}\}/g;
    let match = pattern.exec(value);
    while (match) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length
      });
      match = pattern.exec(value);
    }
    return ranges;
  }

  function getCollapsedDeleteRange(key, caret, ranges) {
    if (key === "Backspace") {
      return ranges.find((range) => caret > range.start && caret <= range.end) ?? null;
    }

    return ranges.find((range) => caret >= range.start && caret < range.end) ?? null;
  }

  function getExpandedDeleteRange(selectionStart, selectionEnd, ranges) {
    const intersected = ranges.filter(
      (range) => range.start < selectionEnd && range.end > selectionStart
    );
    if (intersected.length === 0) {
      return null;
    }

    return {
      start: Math.min(selectionStart, ...intersected.map((range) => range.start)),
      end: Math.max(selectionEnd, ...intersected.map((range) => range.end))
    };
  }

  function applyDraftDeletion(deleteRange, textarea) {
    const value = state.draftText;
    state.draftText = `${value.slice(0, deleteRange.start)}${value.slice(deleteRange.end)}`;
    state.draftSelectionStart = deleteRange.start;
    state.draftSelectionEnd = deleteRange.start;
    syncUIState();

    window.requestAnimationFrame(() => {
      textarea.focus();
      if (typeof textarea.setSelectionRange === "function") {
        textarea.setSelectionRange(deleteRange.start, deleteRange.start);
      }
      updateDraftSelection(textarea);
    });
  }

  function deleteDraftPlaceholderRange(key, textarea) {
    if (!textarea) {
      return false;
    }

    const value = state.draftText;
    const { start, end } = getDraftSelection(value, textarea);
    const ranges = getDraftPlaceholderRanges(value);
    if (ranges.length === 0) {
      return false;
    }

    const deleteRange =
      start === end
        ? getCollapsedDeleteRange(key, start, ranges)
        : getExpandedDeleteRange(start, end, ranges);
    if (!deleteRange) {
      return false;
    }

    applyDraftDeletion(deleteRange, textarea);
    return true;
  }

  function setCollapsed(collapsed) {
    state.collapsed = collapsed;
    if (ui.root) {
      ui.root.classList.toggle(COLLAPSED_CLASS, collapsed);
    }
    syncUIState();
  }

  function scheduleAdapterRefresh() {
    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
    }

    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      refreshAdapterStatus();
    }, 120);
  }

  function refreshAdapterStatus() {
    if (!ui.root) {
      return;
    }

    if (state.isSending) {
      return;
    }

    const adapter = findSiteAdapter();
    if (adapter) {
      setStatus(STATUS.READY, "已连接页面");
      return;
    }

    setStatus(STATUS.MISSING, "未找到官方输入框");
  }

  function setStatus(status, text) {
    state.adapterStatus = status;
    state.lastStatusText = text;
    syncUIState();
  }

  function syncUIState() {
    if (!ui.root) {
      return;
    }

    if (ui.dynamicTextarea.value !== state.dynamicTemplateText) {
      ui.dynamicTextarea.value = state.dynamicTemplateText;
    }
    if (ui.prefixTextarea.value !== state.prefixText) {
      ui.prefixTextarea.value = state.prefixText;
    }
    if (ui.textarea.value !== state.draftText) {
      ui.textarea.value = state.draftText;
    }
    if (ui.suffixTextarea.value !== state.suffixText) {
      ui.suffixTextarea.value = state.suffixText;
    }
    ui.root.classList.toggle(COLLAPSED_CLASS, state.collapsed);
    ui.root.classList.toggle("jm-floating-composer--dynamic-disabled", !state.dynamicEnabled);
    ui.root.classList.toggle("jm-floating-composer--prefix-disabled", !state.prefixEnabled);
    ui.root.classList.toggle("jm-floating-composer--suffix-disabled", !state.suffixEnabled);
    ui.status.textContent = state.lastStatusText;
    ui.status.dataset.status = state.adapterStatus;
    ui.dynamicToggle.textContent = state.dynamicEnabled ? "关闭" : "开启";
    ui.prefixToggle.textContent = state.prefixEnabled ? "关闭" : "开启";
    ui.suffixToggle.textContent = state.suffixEnabled ? "关闭" : "开启";
    syncUnusedTemplateWarning();
    ui.composeHint.textContent = buildComposeHint();

    const hasDraft = state.draftText.trim().length > 0;
    const canSend = !state.isSending && state.adapterStatus === STATUS.READY && hasDraft;

    ui.sendButton.disabled = !canSend;
    ui.sendButton.textContent = state.isSending ? "发送中..." : "发送";
    ui.dynamicTextarea.disabled = state.isSending;
    ui.prefixTextarea.disabled = state.isSending;
    ui.textarea.disabled = state.isSending;
    ui.suffixTextarea.disabled = state.isSending;

    scheduleStatePersist();
  }

  async function sendDraft() {
    if (!state.draftText.trim()) {
      setStatus(STATUS.ERROR, "请输入内容");
      return;
    }

    const promptBuildResult = getComposedPromptBuildResult();
    if (!promptBuildResult.valid) {
      setStatus(STATUS.ERROR, promptBuildResult.reason);
      return;
    }

    const prompts = promptBuildResult.prompts;
    const adapter = findSiteAdapter();
    if (!adapter) {
      setStatus(STATUS.MISSING, "未找到官方输入框");
      return;
    }

    state.isSending = true;
    syncUIState();

    try {
      for (let index = 0; index < prompts.length; index += 1) {
        setStatus(STATUS.SENDING, `正在发送 ${index + 1}/${prompts.length}`);
        await setOfficialPrompt(adapter, prompts[index]);
        await sendViaOfficialUI(adapter);
        if (index < prompts.length - 1) {
          await wait(BATCH_SEND_INTERVAL_MS);
        }
      }
      setStatus(STATUS.READY, "已连接页面");
    } catch (error) {
      console.error("[即梦浮动输入框] 发送失败", error);
      setStatus(STATUS.ERROR, "发送失败，请稍后重试");
    } finally {
      state.isSending = false;
      syncUIState();
      refreshAdapterStatus();
    }
  }

  function getComposedPromptBuildResult() {
    const parseResult = state.dynamicEnabled
      ? parseDynamicTemplates(state.dynamicTemplateText)
      : { valid: true, templateMap: {} };

    if (!parseResult.valid) {
      return {
        valid: false,
        reason: parseResult.reason,
        prompts: []
      };
    }

    const templateMap = parseResult.templateMap;
    const validation = validateDynamicTemplateLengths(templateMap);

    if (!validation.valid) {
      return {
        valid: false,
        reason: validation.reason,
        prompts: []
      };
    }

    const contexts = buildTemplateContexts(templateMap, validation.count);
    const prompts = contexts.map((context) => composePromptFromContext(context));

    return {
      valid: true,
      prompts
    };
  }

  function buildComposedPrompts() {
    const result = getComposedPromptBuildResult();
    return result.valid ? result.prompts : [];
  }

  function composePromptFromContext(templateValues) {
    const prefix = state.prefixEnabled
      ? replaceDynamicPlaceholders(state.prefixText.trim(), templateValues)
      : "";
    const draft = replaceDynamicPlaceholders(state.draftText.trim(), templateValues);
    const suffix = state.suffixEnabled
      ? replaceDynamicPlaceholders(state.suffixText.trim(), templateValues)
      : "";

    let result = draft;

    if (prefix) {
      result = `${ensureTrailingComma(prefix)}${draft}`;
    }

    if (suffix) {
      result = `${result}${ensureLeadingComma(suffix)}`;
    }

    return result;
  }

  function buildComposeHint() {
    const result = getComposedPromptBuildResult();
    if (!result.valid) {
      return result.reason;
    }

    const [firstPrompt = "用户输入"] = result.prompts;
    if (result.prompts.length <= 1) {
      return `实际发送：${firstPrompt}`;
    }
    if (!firstPrompt) {
      return "实际发送：用户输入";
    }
    return `将发送 ${result.prompts.length} 条：第 1 条 ${firstPrompt}`;
  }

  function syncUnusedTemplateWarning() {
    if (!ui.warning) {
      return;
    }

    const warningData = buildUnusedTemplateWarningData();
    ui.warning.hidden = !warningData;
    ui.warning.replaceChildren();

    if (!warningData) {
      return;
    }

    ui.warning.appendChild(document.createTextNode(`有 ${warningData.total} 个动态提示词未被使用：`));

    warningData.shownKeys.forEach((key, index) => {
      if (index > 0) {
        ui.warning.appendChild(document.createTextNode("、"));
      }
      ui.warning.appendChild(createUnusedTemplateButton(key));
    });

    if (warningData.remainingCount > 0) {
      ui.warning.appendChild(document.createTextNode(` 等 ${warningData.remainingCount} 个`));
    }
  }

  function buildUnusedTemplateWarningData() {
    if (!state.dynamicEnabled) {
      return null;
    }

    const parseResult = parseDynamicTemplates(state.dynamicTemplateText);
    if (!parseResult.valid) {
      return null;
    }

    const unusedKeys = getUnusedTemplateKeys(parseResult.templateMap);
    if (unusedKeys.length === 0) {
      return null;
    }

    return {
      total: unusedKeys.length,
      shownKeys: unusedKeys.slice(0, 3),
      remainingCount: unusedKeys.length - Math.min(unusedKeys.length, 3)
    };
  }

  function createUnusedTemplateButton(key) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "jm-floating-composer__warning-btn";
    button.textContent = key;
    button.addEventListener("click", () => {
      insertTemplateKeyIntoDraft(key);
    });
    return button;
  }

  function insertTemplateKeyIntoDraft(key) {
    const placeholder = `{{${key}}}`;
    const textarea = ui.textarea;
    if (!textarea) {
      return;
    }

    const value = state.draftText;
    const { start, end } = getDraftSelection(value, textarea);

    state.draftText = `${value.slice(0, start)}${placeholder}${value.slice(end)}`;
    state.draftSelectionStart = start + placeholder.length;
    state.draftSelectionEnd = state.draftSelectionStart;
    syncUIState();

    window.requestAnimationFrame(() => {
      textarea.focus();
      const nextCaret = state.draftSelectionStart;
      if (typeof textarea.setSelectionRange === "function") {
        textarea.setSelectionRange(nextCaret, nextCaret);
      }
      updateDraftSelection(textarea);
    });
  }

  function getUnusedTemplateKeys(templateMap) {
    const templateKeys = Object.keys(templateMap);
    if (templateKeys.length === 0) {
      return [];
    }

    const usedKeys = new Set(extractTemplateKeys(getActiveTemplateSourceText()));
    return templateKeys.filter((key) => !usedKeys.has(key));
  }

  function getActiveTemplateSourceText() {
    return [
      state.prefixEnabled ? state.prefixText : "",
      state.draftText,
      state.suffixEnabled ? state.suffixText : ""
    ].join("\n");
  }

  function extractTemplateKeys(text) {
    const matches = text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g);
    return Array.from(matches, (match) => normalizeTemplateKey(match[1])).filter(Boolean);
  }

  async function hydratePersistedState() {
    try {
      const persisted = await readPersistedState();
      if (persisted && typeof persisted === "object") {
        if (typeof persisted.dynamicTemplateText === "string") {
          state.dynamicTemplateText = persisted.dynamicTemplateText;
        }
        if (typeof persisted.dynamicEnabled === "boolean") {
          state.dynamicEnabled = persisted.dynamicEnabled;
        }
        if (typeof persisted.prefixEnabled === "boolean") {
          state.prefixEnabled = persisted.prefixEnabled;
        }
        if (typeof persisted.prefixText === "string") {
          state.prefixText = persisted.prefixText;
        }
        if (typeof persisted.draftText === "string") {
          state.draftText = persisted.draftText;
        }
        if (typeof persisted.suffixEnabled === "boolean") {
          state.suffixEnabled = persisted.suffixEnabled;
        }
        if (typeof persisted.suffixText === "string") {
          state.suffixText = persisted.suffixText;
        }
        if (typeof persisted.collapsed === "boolean") {
          state.collapsed = persisted.collapsed;
        }
      }
    } catch (error) {
      console.error("[即梦浮动输入框] 读取 IndexedDB 失败", error);
    } finally {
      state.hydrated = true;
      syncUIState();
    }
  }

  function scheduleStatePersist() {
    if (!state.hydrated) {
      return;
    }
    if (persistTimer) {
      window.clearTimeout(persistTimer);
    }
    persistTimer = window.setTimeout(() => {
      persistTimer = null;
      void persistStateSnapshot();
    }, 120);
  }

  async function persistStateSnapshot() {
    try {
      const db = await getDb();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        store.put(buildPersistedState(), STATE_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } catch (error) {
      console.error("[即梦浮动输入框] 写入 IndexedDB 失败", error);
    }
  }

  async function readPersistedState() {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(STATE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function buildPersistedState() {
    return {
      dynamicTemplateText: state.dynamicTemplateText,
      dynamicEnabled: state.dynamicEnabled,
      prefixEnabled: state.prefixEnabled,
      prefixText: state.prefixText,
      draftText: state.draftText,
      suffixEnabled: state.suffixEnabled,
      suffixText: state.suffixText,
      collapsed: state.collapsed
    };
  }

  function getDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    return dbPromise;
  }

  function ensureTrailingComma(text) {
    return /[，,]\s*$/.test(text) ? text : `${text}，`;
  }

  function ensureLeadingComma(text) {
    return /^[，,]\s*/.test(text) ? text : `，${text}`;
  }

  function parseDynamicTemplates(text) {
    const normalized = text.trim();
    if (!normalized) {
      return {
        valid: true,
        templateMap: {}
      };
    }

    const candidates = buildDynamicTemplateCandidates(normalized);
    for (const candidate of candidates) {
      const parsed = tryParseDynamicTemplateObject(candidate);
      if (parsed) {
        return {
          valid: true,
          templateMap: parsed
        };
      }
    }

    return {
      valid: false,
      reason: "动态提示词格式错误"
    };
  }

  function buildDynamicTemplateCandidates(text) {
    const candidates = new Set();
    const trimmed = text.trim();

    candidates.add(trimmed);

    const stripped = stripOptionalBraces(trimmed);
    candidates.add(`{${stripped}}`);

    const lineJoined = stripped
      .split("\n")
      .map((line) => line.trim().replace(/,\s*$/, ""))
      .filter(Boolean)
      .join(",");
    if (lineJoined) {
      candidates.add(`{${lineJoined}}`);
    }

    return Array.from(candidates)
      .map((candidate) => candidate.replace(/,\s*}/g, "}"))
      .filter(Boolean);
  }

  function stripOptionalBraces(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  }

  function tryParseDynamicTemplateObject(text) {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        return null;
      }

      const templateMap = {};
      for (const [rawKey, rawValues] of Object.entries(parsed)) {
        const key = normalizeTemplateKey(rawKey);
        if (!key || !Array.isArray(rawValues) || rawValues.length === 0) {
          return null;
        }

        const values = rawValues
          .filter((value) => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean);

        if (values.length !== rawValues.length || values.length === 0) {
          return null;
        }

        templateMap[key] = values;
      }

      return templateMap;
    } catch (error) {
      return null;
    }
  }

  function validateDynamicTemplateLengths(templateMap) {
    const entries = Object.entries(templateMap);
    if (entries.length === 0) {
      return {
        valid: true,
        count: 1
      };
    }

    const lengths = entries.map(([, values]) => values.length);
    const maxLength = Math.max(...lengths);

    if (maxLength <= 1) {
      return {
        valid: true,
        count: 1
      };
    }

    const allEqual = lengths.every((length) => length === maxLength);
    if (!allEqual) {
      return {
        valid: false,
        reason: "动态提示词多值数量不一致"
      };
    }

    return {
      valid: true,
      count: maxLength
    };
  }

  function buildTemplateContexts(templateMap, count) {
    const entries = Object.entries(templateMap);
    if (entries.length === 0 || count <= 1) {
      return [Object.fromEntries(entries.map(([key, values]) => [key, values[0] || ""]))];
    }

    return Array.from({ length: count }, (_, index) =>
      Object.fromEntries(entries.map(([key, values]) => [key, values[index] || ""]))
    );
  }

  function normalizeTemplateKey(key) {
    return key.trim().replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "");
  }

  function replaceDynamicPlaceholders(text, templateValues) {
    if (!text) {
      return text;
    }

    return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key) => {
      const normalizedKey = normalizeTemplateKey(key);
      return Object.prototype.hasOwnProperty.call(templateValues, normalizedKey)
        ? templateValues[normalizedKey]
        : match;
    });
  }

  function findSiteAdapter() {
    const editorEl = findBestEditor();
    const submitEl = findBestSubmitButton();

    if (!editorEl || !submitEl) {
      return null;
    }

    return {
      editorEl,
      submitEl,
      editorType: getEditorType(editorEl)
    };
  }

  function findBestEditor() {
    const selector = [
      'textarea',
      '[contenteditable="true"]',
      '[contenteditable="plaintext-only"]'
    ].join(",");

    const candidates = Array.from(document.querySelectorAll(selector))
      .filter((element) => !isInsideExtensionUI(element))
      .filter(isVisibleElement)
      .map((element) => ({
        element,
        score: scoreEditorCandidate(element)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    return candidates.length > 0 ? candidates[0].element : null;
  }

  function findBestSubmitButton() {
    const selector = [
      "button",
      '[role="button"]',
      "div",
      "span"
    ].join(",");

    const seen = new Set();
    const candidates = Array.from(document.querySelectorAll(selector))
      .filter((element) => !isInsideExtensionUI(element))
      .map(normalizeSubmitElement)
      .filter((element) => {
        if (!element || seen.has(element)) {
          return false;
        }
        seen.add(element);
        return true;
      })
      .filter(isVisibleElement)
      .map((element) => ({
        element,
        score: scoreSubmitCandidate(element)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    return candidates.length > 0 ? candidates[0].element : null;
  }

  function normalizeSubmitElement(element) {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    return (
      element.closest(
        'button, [role="button"], [class*="submit-button-"], [class*="collapsed-submit-button-"]'
      ) || element
    );
  }

  function scoreEditorCandidate(element) {
    const text = collectSemanticText(element);
    let score = 0;

    if (/(prompt-input-|prompt-container-|prompt-editor-)/.test(text)) {
      score += 8;
    }
    if (element.matches("textarea")) {
      score += 4;
    }
    if (element.isContentEditable) {
      score += 4;
    }
    if (/(prompt|描述|提示|输入|textarea|contenteditable)/i.test(text)) {
      score += 3;
    }
    if (hasAncestorSemanticMatch(element, /(prompt-input-|prompt-container-|prompt-editor-)/)) {
      score += 4;
    }
    if (isNearBottom(element)) {
      score += 2;
    }

    return score;
  }

  function scoreSubmitCandidate(element) {
    const text = collectSemanticText(element);
    let score = 0;

    if (/(submit-button-|collapsed-submit-button-)/.test(text)) {
      score += 10;
    }
    if (/(submit|send|发送|生成|创作)/i.test(text)) {
      score += 3;
    }
    if (hasAncestorSemanticMatch(element, /(submit-button-|collapsed-submit-button-)/)) {
      score += 5;
    }
    if (element.tagName === "BUTTON") {
      score += 2;
    }
    if (isNearBottom(element)) {
      score += 2;
    }

    if (isSubmitUnavailable(element)) {
      score -= 4;
    }

    return score;
  }

  function collectSemanticText(element) {
    const parts = [];
    let current = element;
    let depth = 0;

    while (current && depth < 4) {
      if (typeof current.className === "string") {
        parts.push(current.className);
      }
      if (typeof current.getAttribute === "function") {
        parts.push(current.getAttribute("aria-label") || "");
        parts.push(current.getAttribute("placeholder") || "");
        parts.push(current.getAttribute("data-placeholder") || "");
        parts.push(current.getAttribute("title") || "");
      }
      current = current.parentElement;
      depth += 1;
    }

    return parts.join(" ");
  }

  function hasAncestorSemanticMatch(element, regex) {
    let current = element.parentElement;
    let depth = 0;

    while (current && depth < 4) {
      if (typeof current.className === "string" && regex.test(current.className)) {
        return true;
      }
      current = current.parentElement;
      depth += 1;
    }

    return false;
  }

  function isVisibleElement(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    if (rect.width < 8 || rect.height < 8) {
      return false;
    }
    if (rect.bottom < 0 || rect.right < 0) {
      return false;
    }

    return true;
  }

  function isNearBottom(element) {
    const rect = element.getBoundingClientRect();
    return rect.top >= window.innerHeight * 0.45;
  }

  function isInsideExtensionUI(element) {
    return Boolean(element.closest(`#${ROOT_ID}`));
  }

  function getEditorType(editorEl) {
    return editorEl.matches("textarea") ? "textarea" : "contenteditable";
  }

  async function setOfficialPrompt(adapter, text) {
    if (adapter.editorType === "textarea") {
      writeTextareaValue(adapter.editorEl, text);
      return;
    }

    writeContentEditableValue(adapter.editorEl, text);
  }

  function writeTextareaValue(element, text) {
    element.focus();

    const prototype = window.HTMLTextAreaElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (!descriptor || typeof descriptor.set !== "function") {
      throw new Error("无法设置 textarea value");
    }

    descriptor.set.call(element, text);
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: text,
        inputType: "insertText"
      })
    );
    element.dispatchEvent(
      new Event("change", {
        bubbles: true
      })
    );
    if (typeof element.setSelectionRange === "function") {
      element.setSelectionRange(text.length, text.length);
    }
  }

  function writeContentEditableValue(element, text) {
    element.focus();

    const beforeInput = safeCreateInputEvent("beforeinput", text);
    if (beforeInput) {
      element.dispatchEvent(beforeInput);
    }

    replaceContentEditableText(element, text);

    const input = safeCreateInputEvent("input", text);
    if (input) {
      element.dispatchEvent(input);
    } else {
      element.dispatchEvent(
        new Event("input", {
          bubbles: true,
          composed: true
        })
      );
    }
  }

  function safeCreateInputEvent(type, text) {
    try {
      return new InputEvent(type, {
        bubbles: true,
        composed: true,
        cancelable: type === "beforeinput",
        data: text,
        inputType: "insertText"
      });
    } catch (error) {
      return null;
    }
  }

  function replaceContentEditableText(element, text) {
    const selection = window.getSelection();
    const range = document.createRange();

    range.selectNodeContents(element);
    range.deleteContents();

    const fragment = document.createDocumentFragment();
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      fragment.appendChild(document.createTextNode(line));
      if (index < lines.length - 1) {
        fragment.appendChild(document.createElement("br"));
      }
    });

    range.insertNode(fragment);
    range.selectNodeContents(element);
    range.collapse(false);

    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  async function sendViaOfficialUI(adapter) {
    const latestAdapter = await waitForReadySubmit(adapter);
    if (!latestAdapter || isSubmitUnavailable(latestAdapter.submitEl)) {
      throw new Error("官方发送按钮不可用");
    }

    latestAdapter.submitEl.click();
  }

  async function waitForReadySubmit(adapter) {
    const deadline = Date.now() + 2000;
    let latestAdapter = adapter;

    while (Date.now() < deadline) {
      latestAdapter = findSiteAdapter() || latestAdapter;
      if (latestAdapter && !isSubmitUnavailable(latestAdapter.submitEl)) {
        return latestAdapter;
      }
      await wait(80);
    }

    return latestAdapter;
  }

  function isSubmitUnavailable(element) {
    if (!(element instanceof HTMLElement)) {
      return true;
    }

    if (!isVisibleElement(element)) {
      return true;
    }

    const semanticText = collectSemanticText(element);
    if (semanticText.includes("lv-btn-disabled")) {
      return true;
    }
    if (element.getAttribute("aria-disabled") === "true") {
      return true;
    }
    if ("disabled" in element && element.disabled) {
      return true;
    }
    if (element.hasAttribute("disabled")) {
      return true;
    }

    const style = window.getComputedStyle(element);
    if (style.pointerEvents === "none") {
      return true;
    }

    return false;
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }
})();
