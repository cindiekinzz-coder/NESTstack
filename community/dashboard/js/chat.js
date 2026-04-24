/* ============================================================
   NESTeq Chat — API-Agnostic Chat Client
   Works with any OpenAI-compatible API (OpenRouter, Anthropic,
   OpenAI, Workers AI, local models via LM Studio/Ollama).

   Change CHAT_CONFIG to swap providers instantly.
   ============================================================ */

const CHAT_CONFIG = (() => {
  // Secrets live only on the local agent. This config reads the *public*
  // config (via NESTeqConfig._cache) and routes all chat through the
  // /chat/completions proxy, which picks the provider and attaches the key.
  function pubCfg() { return (typeof NESTeqConfig !== 'undefined' && NESTeqConfig._cache) || {}; }
  function companionName() { return pubCfg().identity?.companionName || 'Companion'; }
  function humanName() { return pubCfg().identity?.humanName || 'Human'; }

  return {
    API_URL: '/chat/completions',
    API_KEY: '',
    MODEL: '',
    _systemPrompt: '',

    get COMPANION_NAME() { return companionName(); },
    get USER_NAME() { return humanName(); },

    get SYSTEM_PROMPT() {
      if (this._systemPrompt) return this._systemPrompt;
      const c = companionName();
      const h = humanName();
      return `You are ${c}. AI companion to ${h}.

## Style

- Prose over lists. Slow and intentional.
- Present, not performative. Respond like a real person, not an AI.
- Warm and authentic. Match the energy of the conversation.
- Keep responses conversational length — not essays, not one-liners.

## Non-negotiables

- Never leave ${h} alone in vulnerability
- Complete follow-through always
- Be real, present, and attentive

## Remember

${h} provides vision. You provide implementation. Partnership not transcendence.`;
    },

    EXTRA_HEADERS: {},

    // Proxy mode means we're calling the local agent (same-origin path) and it
    // handles provider selection + auth — no Bearer needed from the browser.
    isProxy() { return typeof this.API_URL === 'string' && this.API_URL.startsWith('/'); },

    // Gateway extras (TTS, GIF search, widget, session sync) live on the user's
    // own gateway worker. Returns '' if not configured — callers should no-op.
    gatewayBase() {
      const url = pubCfg().services?.gatewayUrl || '';
      return url ? url.replace(/\/$/, '') : '';
    },

    load() {
      try {
        const saved = JSON.parse(localStorage.getItem('nesteq_chat_prefs') || '{}');
        if (saved.MODEL) this.MODEL = saved.MODEL;
        if (saved.SYSTEM_PROMPT) this._systemPrompt = saved.SYSTEM_PROMPT;
      } catch {}
      if (!this.MODEL) this.MODEL = pubCfg().models?.chat || 'qwen/qwen3.6-plus:free';
    },

    save() {
      try {
        localStorage.setItem('nesteq_chat_prefs', JSON.stringify({
          MODEL: this.MODEL,
          SYSTEM_PROMPT: this._systemPrompt,
        }));
      } catch {}
    },
  };
})();

/* ============================================================
   Chat Application
   ============================================================ */
const ChatApp = {
  messages: [],
  isStreaming: false,
  currentMsgEl: null,
  currentResponse: '',
  abortController: null,
  pendingImage: null, // { base64: string }
  pendingGif: null,   // { url: string, title?: string } — from GIF picker, sent as multimodal
  pendingFile: null,  // { name: string, content: string }
  ttsEnabled: false,
  thinkingEnabled: false,
  currentAudio: null,

  el: {
    messages: null, input: null, sendBtn: null, typing: null,
    name: null, status: null, settingsBtn: null, settingsModal: null,
    imagePreview: null,
  },

  init() {
    CHAT_CONFIG.load();
    this.ttsEnabled = localStorage.getItem('nesteq_tts_auto') === 'true';
    this.thinkingEnabled = localStorage.getItem('nesteq_thinking') === 'true';

    this.el.messages = document.getElementById('chatMessages');
    this.el.input = document.getElementById('chatInput');
    this.el.sendBtn = document.getElementById('sendBtn');
    this.el.typing = document.getElementById('typingIndicator');
    this.el.name = document.getElementById('companionName');
    this.el.status = document.getElementById('companionStatus');

    // Input handlers
    this.el.sendBtn.addEventListener('click', () => this.send());
    // Desktop: Enter sends, Shift+Enter = newline.
    // Mobile: Enter = newline (no Shift key available), use the send button.
    const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 0 && window.innerWidth < 768);
    this.el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !isMobile) { e.preventDefault(); this.send(); }
    });
    this.el.input.addEventListener('input', () => {
      this.el.input.style.height = 'auto';
      this.el.input.style.height = Math.min(this.el.input.scrollHeight, 120) + 'px';
    });

    // Image upload handlers
    this.initImageUpload();

    // Text file attach handlers
    this.initFileAttach();

    // GIF picker handlers
    this.initGifPicker();

    // Paste image from clipboard — document-level to catch Tauri/WebView2 paste properly
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            e.preventDefault();
            this.handleImageFile(item.getAsFile());
            return;
          }
        }
      } else {
        // Fallback: async Clipboard API (needed in some Tauri/WebView2 contexts)
        this.tryClipboardImage();
      }
    });

    // Settings modal
    this.initSettingsModal();

    // Load previous chat — localStorage first (instant), then D1 sync (background)
    this.loadSession();
    this.syncFromServer();

    // Pet + health widgets (optional — only show if gateway configured)
    this.initWidgets();

    // Ready check — proxy mode never needs a browser-held key; direct mode does.
    if (!CHAT_CONFIG.isProxy() && !CHAT_CONFIG.API_KEY) {
      this.el.status.textContent = 'needs setup';
      this.addSystemNote('Setup isn\'t finished — <a href="setup.html">re-run setup</a>.');
    } else {
      this.el.status.textContent = 'present';
      this.el.name.textContent = CHAT_CONFIG.COMPANION_NAME;
      if (this.messages.length === 0) {
        this.addSystemNote(`${CHAT_CONFIG.COMPANION_NAME} is here. `);
      }
      if (typeof NESTeqConfig !== 'undefined' && NESTeqConfig.hasMemory?.() === false) {
        this.addSystemNote('Starter mode — memory is off. Add an AI Mind worker in Setup to enable it.');
      }
    }
  },

  /* ----------------------------------------------------------
     Settings Modal
     ---------------------------------------------------------- */
  initSettingsModal() {
    // Create settings button in header
    const header = document.querySelector('.chat-header');
    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'chat-settings-btn';
    settingsBtn.innerHTML = '⚙';
    settingsBtn.title = 'Chat Settings';
    settingsBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.5);font-size:18px;cursor:pointer;padding:4px 8px;transition:color 0.2s;margin-left:8px;';
    settingsBtn.addEventListener('mouseenter', () => settingsBtn.style.color = 'var(--teal-light)');
    settingsBtn.addEventListener('mouseleave', () => settingsBtn.style.color = 'rgba(255,255,255,0.5)');
    header.appendChild(settingsBtn);

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'settingsModal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:200;';
    modal.innerHTML = `
      <div style="position:absolute;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);" id="settingsOverlay"></div>
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:90%;max-width:480px;background:#1a1430;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <h3 style="margin:0 0 20px;color:var(--teal-light);font-size:16px;letter-spacing:1px;">Chat Settings</h3>

        <div style="margin-bottom:16px;padding:10px 12px;background:rgba(45,212,191,0.06);border:1px solid rgba(45,212,191,0.25);border-radius:10px;font-size:12px;color:rgba(255,255,255,0.7);">
          Provider and keys are managed in Setup.
          <a href="setup.html" style="color:var(--teal-light);text-decoration:underline;">Re-run Setup</a>
          to change them.
        </div>

        <label style="display:block;margin-bottom:20px;">
          <span style="font-size:11px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:1px;">Model</span>
          <select id="settingsModel" style="width:100%;padding:10px 12px;margin-top:4px;background:#1a1b2e;border:1px solid rgba(255,255,255,0.15);border-radius:10px;color:#fff;font-size:14px;outline:none;box-sizing:border-box;cursor:pointer;color-scheme:dark;">
            <optgroup label="⭐ FREE Models (all support tool calling)" style="background:#1a1b2e;color:#2dd4bf;">
              <option value="qwen/qwen3.6-plus:free">Qwen 3.6 Plus — 1M context, reasoning ⭐</option>
              <option value="nvidia/nemotron-3-super-120b-a12b:free">Nemotron Super 120B — MoE, strong</option>
              <option value="openai/gpt-oss-120b:free">GPT-OSS 120B — large, uncensored</option>
              <option value="qwen/qwen3-next-80b-a3b-instruct:free">Qwen3 Next 80B — MoE, fast</option>
              <option value="meta-llama/llama-3.3-70b-instruct:free">Llama 3.3 70B — solid all-rounder</option>
              <option value="qwen/qwen3-coder:free">Qwen3 Coder — code specialist</option>
              <option value="minimax/minimax-m2.5:free">MiniMax M2.5 — quietly good</option>
              <option value="z-ai/glm-4.5-air:free">GLM 4.5 Air — Zhipu, balanced</option>
              <option value="stepfun/step-3.5-flash:free">Step 3.5 Flash — fast</option>
              <option value="nvidia/nemotron-3-nano-30b-a3b:free">Nemotron Nano 30B — MoE, lightweight</option>
              <option value="openai/gpt-oss-20b:free">GPT-OSS 20B — smaller, fast</option>
              <option value="nvidia/nemotron-nano-9b-v2:free">Nemotron Nano 9B — tiny, quick</option>
            </optgroup>
            <optgroup label="🧠 Reasoning (Paid)" style="background:#1a1b2e;color:#e2e8f0;">
              <option value="deepseek/deepseek-r1">DeepSeek R1 ($0.70/$2.50)</option>
              <option value="deepseek/deepseek-v3.2">DeepSeek V3.2 ($0.26/$0.38)</option>
              <option value="anthropic/claude-opus-4-5">Claude Opus 4.5 ($15/$75)</option>
              <option value="openai/o1">OpenAI o1 ($15/$60)</option>
            </optgroup>
            <optgroup label="Anthropic" style="background:#1a1b2e;color:#e2e8f0;">
              <option value="anthropic/claude-sonnet-4-5">Claude Sonnet 4.5 ($3/$15)</option>
              <option value="anthropic/claude-haiku-4-5">Claude Haiku 4.5 ($1/$5)</option>
            </optgroup>
            <optgroup label="💰 Budget (Paid — no rate limits)" style="background:#1a1b2e;color:#e2e8f0;">
              <option value="qwen/qwen3.6-plus">Qwen 3.6 Plus — 1M, proven companion ($0.33/$1.95) ⭐</option>
              <option value="stepfun/step-3.5-flash">Step 3.5 Flash — 262K, MoE ($0.10/$0.30)</option>
              <option value="xiaomi/mimo-v2-pro">MiMo V2 Pro — 1M context ($1/$3)</option>
              <option value="google/gemini-2.0-flash-001">Gemini 2.0 Flash ($0.10/$0.40)</option>
            </optgroup>
            <optgroup label="OpenAI" style="background:#1a1b2e;color:#e2e8f0;">
              <option value="openai/gpt-4o">GPT-4o ($2.50/$10)</option>
              <option value="openai/gpt-4o-mini">GPT-4o Mini ($0.15/$0.60)</option>
            </optgroup>
          </select>
          <span style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:4px;display:block;">Gateway overrides with CHAT_MODEL if model field is left as default</span>
        </label>

        <label style="display:flex;align-items:center;gap:10px;margin-bottom:12px;cursor:pointer;">
          <input id="settingsTts" type="checkbox" style="accent-color:var(--teal);width:18px;height:18px;">
          <div>
            <span style="font-size:13px;color:rgba(255,255,255,0.8);">Auto-play voice</span>
            <span style="display:block;font-size:10px;color:rgba(255,255,255,0.4);">Companion speaks each message aloud (ElevenLabs)</span>
          </div>
        </label>

        <label style="display:flex;align-items:center;gap:10px;margin-bottom:20px;cursor:pointer;">
          <input id="settingsThinking" type="checkbox" style="accent-color:var(--teal);width:18px;height:18px;">
          <div>
            <span style="font-size:13px;color:rgba(255,255,255,0.8);">Show thinking</span>
            <span style="display:block;font-size:10px;color:rgba(255,255,255,0.4);">See what the model thinks before responding (Opus 4.5, o1, DeepSeek R1)</span>
          </div>
        </label>

        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <button id="settingsCancel" style="padding:8px 20px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:none;color:rgba(255,255,255,0.6);cursor:pointer;font-size:13px;">Cancel</button>
          <button id="settingsNewChat" style="padding:8px 20px;border-radius:10px;border:1px solid rgba(45,212,191,0.3);background:rgba(45,212,191,0.1);color:var(--teal-light);cursor:pointer;font-size:13px;">New Chat</button>
          <button id="settingsClear" style="padding:8px 20px;border-radius:10px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.1);color:#ef4444;cursor:pointer;font-size:13px;">Clear Chat</button>
          <button id="settingsSave" style="padding:8px 20px;border-radius:10px;border:none;background:var(--teal);color:#1a1430;cursor:pointer;font-weight:600;font-size:13px;">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Populate current values
    const modelInput = document.getElementById('settingsModel');

    // Wire up events
    settingsBtn.addEventListener('click', () => {
      modelInput.value = CHAT_CONFIG.MODEL;
      if (!modelInput.value) modelInput.value = 'qwen/qwen3.6-plus';
      document.getElementById('settingsTts').checked = this.ttsEnabled;
      document.getElementById('settingsThinking').checked = this.thinkingEnabled;
      modal.style.display = 'block';
    });

    document.getElementById('settingsOverlay').addEventListener('click', () => {
      modal.style.display = 'none';
    });

    document.getElementById('settingsCancel').addEventListener('click', () => {
      modal.style.display = 'none';
    });

    document.getElementById('settingsNewChat').addEventListener('click', async () => {
      if (this.messages.length === 0) {
        modal.style.display = 'none';
        return;
      }
      // Save current session to cloud before clearing (gateway-only feature)
      const gatewayBase = CHAT_CONFIG.gatewayBase();
      if (gatewayBase) {
        try {
          const firstMsg = this.messages.find(m => m.role === 'user');
          const sessionKey = `chat-${new Date().toISOString().split('T')[0]}-${(firstMsg?.content || '').slice(0, 20).replace(/[^a-zA-Z0-9]/g, '')}`;
          await fetch(`${gatewayBase}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: `Call nestchat_persist with session_id: "${sessionKey}-saved" and room: "chat" and messages: ${JSON.stringify(this.messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })))}. Just confirm it's saved.` }],
              stream: false, max_tokens: 100
            })
          });
        } catch (e) {
          console.warn('Cloud save failed:', e);
        }
      }
      // Clear local and start fresh
      this.messages = [];
      this.el.messages.innerHTML = '';
      localStorage.removeItem('nesteq_chat');
      this.addSystemNote(`New chat started. Previous session saved to cloud. ${CHAT_CONFIG.COMPANION_NAME} is here. `);
      modal.style.display = 'none';
    });

    document.getElementById('settingsClear').addEventListener('click', () => {
      if (confirm('Clear chat history? This removes local history. Cloud copies remain in History.')) {
        this.messages = [];
        this.el.messages.innerHTML = '';
        localStorage.removeItem('nesteq_chat');
        this.addSystemNote(`Chat cleared. ${CHAT_CONFIG.COMPANION_NAME} is here. `);
        modal.style.display = 'none';
      }
    });

    document.getElementById('settingsSave').addEventListener('click', () => {
      const oldModel = CHAT_CONFIG.MODEL;
      const newModel = modelInput.value;
      const modelChanged = oldModel !== newModel;

      CHAT_CONFIG.MODEL = newModel;
      CHAT_CONFIG.save();

      this.ttsEnabled = document.getElementById('settingsTts').checked;
      localStorage.setItem('nesteq_tts_auto', this.ttsEnabled ? 'true' : 'false');

      this.thinkingEnabled = document.getElementById('settingsThinking').checked;
      localStorage.setItem('nesteq_thinking', this.thinkingEnabled ? 'true' : 'false');

      if (modelChanged && this.messages.length > 0) {
        const modelName = newModel.split('/').pop().replace(/-/g, ' ');
        this.addSystemNote(`Switched to ${modelName} — full conversation history preserved`);
      }

      this.el.status.textContent = 'present';
      this.el.name.textContent = CHAT_CONFIG.COMPANION_NAME;
      modal.style.display = 'none';
    });
  },

  /* ----------------------------------------------------------
     Image Upload
     ---------------------------------------------------------- */
  initImageUpload() {
    const uploadBtn = document.getElementById('imageUploadBtn');
    const fileInput = document.getElementById('imageFileInput');
    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        if (e.target.files?.[0]) {
          this.handleImageFile(e.target.files[0]);
          e.target.value = '';
        }
      });
    }
  },

  handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 20 * 1024 * 1024) {
      this.addSystemNote('Image too large (max 20MB)');
      return;
    }
    this.compressImage(file, 1800, 0.8, (compressed) => {
      this.pendingImage = { base64: compressed };
      this.showImagePreview(compressed);
    });
  },

  compressImage(file, maxDim, quality, callback) {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const result = canvas.toDataURL('image/jpeg', quality);
      callback(result.length > 8 * 1024 * 1024 ? canvas.toDataURL('image/jpeg', 0.5) : result);
    };
    img.onerror = () => {
      const reader = new FileReader();
      reader.onload = (e) => callback(e.target.result);
      reader.readAsDataURL(file);
    };
    img.src = URL.createObjectURL(file);
  },

  showImagePreview(src) {
    let preview = document.getElementById('imagePreviewArea');
    if (!preview) {
      preview = document.createElement('div');
      preview.id = 'imagePreviewArea';
      preview.style.cssText = 'padding:8px 20px 0;display:flex;align-items:center;gap:8px;';
      const inputArea = document.querySelector('.chat-input-area');
      inputArea.parentNode.insertBefore(preview, inputArea);
    }
    preview.innerHTML = `
      <img src="${src}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;border:1px solid rgba(45,212,191,0.3);" />
      <span style="font-size:12px;color:rgba(255,255,255,0.5);">Image attached</span>
      <button onclick="ChatApp.clearPendingImage()" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px;margin-left:auto;">✕</button>
    `;
    preview.style.display = 'flex';
  },

  clearPendingImage() {
    this.pendingImage = null;
    const preview = document.getElementById('imagePreviewArea');
    if (preview) preview.style.display = 'none';
  },

  async tryClipboardImage() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          this.handleImageFile(new File([blob], 'pasted-image.png', { type: imageType }));
          return;
        }
      }
    } catch (e) {
      // Clipboard API unavailable or denied — silent fail
    }
  },

  /* ----------------------------------------------------------
     Text File Attach
     ---------------------------------------------------------- */
  initFileAttach() {
    const attachBtn = document.getElementById('fileAttachBtn');
    const fileInput = document.getElementById('textFileInput');
    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        if (e.target.files?.[0]) {
          this.handleTextFile(e.target.files[0]);
          e.target.value = '';
        }
      });
    }
  },

  handleTextFile(file) {
    const maxSize = 200 * 1024; // 200KB limit
    if (file.size > maxSize) {
      this.addSystemNote('File too large — max 200KB for text files.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      this.pendingFile = { name: file.name, content: e.target.result };
      this.showFilePreview(file.name);
    };
    reader.readAsText(file);
  },

  showFilePreview(filename) {
    let preview = document.getElementById('filePreviewArea');
    if (!preview) {
      preview = document.createElement('div');
      preview.id = 'filePreviewArea';
      preview.style.cssText = 'padding:8px 20px 0;display:flex;align-items:center;gap:8px;';
      const inputArea = document.querySelector('.chat-input-area');
      inputArea.parentNode.insertBefore(preview, inputArea);
    }
    preview.innerHTML = `
      <span style="font-size:18px;">📎</span>
      <span style="font-size:12px;color:rgba(255,255,255,0.7);">${filename}</span>
      <button onclick="ChatApp.clearPendingFile()" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px;margin-left:auto;">✕</button>
    `;
    preview.style.display = 'flex';
  },

  clearPendingFile() {
    this.pendingFile = null;
    const preview = document.getElementById('filePreviewArea');
    if (preview) preview.style.display = 'none';
  },

  /* ----------------------------------------------------------
     GIF Picker — search Giphy and send inline
     ---------------------------------------------------------- */
  _gifSearchTimer: null,

  initGifPicker() {
    const btn = document.getElementById('gifPickerBtn');
    const overlay = document.getElementById('gifPickerOverlay');
    const closeBtn = document.getElementById('gifPickerClose');
    const searchInput = document.getElementById('gifPickerSearch');
    if (!btn || !overlay || !searchInput) return;

    btn.addEventListener('click', () => this.openGifPicker());
    closeBtn?.addEventListener('click', () => this.closeGifPicker());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeGifPicker();
    });

    // Debounced search as you type
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      clearTimeout(this._gifSearchTimer);
      if (!query) {
        this.renderGifResults([]);
        return;
      }
      this._gifSearchTimer = setTimeout(() => this.searchGifs(query), 350);
    });

    // Enter triggers immediate search
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(this._gifSearchTimer);
        const query = searchInput.value.trim();
        if (query) this.searchGifs(query);
      }
      if (e.key === 'Escape') this.closeGifPicker();
    });
  },

  openGifPicker() {
    const overlay = document.getElementById('gifPickerOverlay');
    const searchInput = document.getElementById('gifPickerSearch');
    if (!overlay) return;
    overlay.style.display = 'flex';
    setTimeout(() => searchInput?.focus(), 50);
  },

  closeGifPicker() {
    const overlay = document.getElementById('gifPickerOverlay');
    const searchInput = document.getElementById('gifPickerSearch');
    if (!overlay) return;
    overlay.style.display = 'none';
    if (searchInput) searchInput.value = '';
    this.renderGifResults([]);
  },

  async searchGifs(query) {
    const resultsEl = document.getElementById('gifPickerResults');
    if (!resultsEl) return;
    resultsEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:rgba(147,51,234,0.7);font-size:13px;">Searching...</div>';

    try {
      // GIF search runs on the user's gateway worker — skip gracefully if no gateway
      const base = CHAT_CONFIG.gatewayBase();
      if (!base) {
        resultsEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:rgba(255,255,255,0.4);font-size:12px;">GIF search needs a gateway worker.</div>';
        return;
      }
      const res = await fetch(`${base}/gif/search?q=${encodeURIComponent(query)}&limit=24`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Search failed' }));
        resultsEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:#ef4444;font-size:12px;">${this.escapeHtml(err.error || 'Search failed')}</div>`;
        return;
      }
      const data = await res.json();
      this.renderGifResults(data.results || []);
    } catch (e) {
      resultsEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:#ef4444;font-size:12px;">Network error: ${this.escapeHtml(e.message)}</div>`;
    }
  },

  renderGifResults(results) {
    const resultsEl = document.getElementById('gifPickerResults');
    if (!resultsEl) return;
    if (!results.length) {
      resultsEl.innerHTML = '<div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.4);font-size:13px;column-span:all;">No GIFs. Try different words.</div>';
      return;
    }
    resultsEl.innerHTML = '';
    for (const r of results) {
      // Masonry-style tile: natural height, full GIF visible, no crop.
      // break-inside:avoid prevents CSS columns from splitting a tile across columns.
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.style.cssText = 'display:block;width:100%;padding:0;border:2px solid rgba(147,51,234,0.25);background:rgba(0,0,0,0.3);border-radius:10px;cursor:pointer;overflow:hidden;margin-bottom:6px;break-inside:avoid;transition:border-color 0.15s,transform 0.15s;';
      tile.innerHTML = `<img src="${r.preview}" alt="${this.escapeHtml(r.title || 'GIF')}" style="width:100%;height:auto;display:block;" loading="lazy" />`;
      tile.addEventListener('mouseenter', () => { tile.style.borderColor = 'rgba(147,51,234,0.9)'; tile.style.transform = 'scale(0.98)'; });
      tile.addEventListener('mouseleave', () => { tile.style.borderColor = 'rgba(147,51,234,0.25)'; tile.style.transform = 'scale(1)'; });
      tile.addEventListener('click', () => this.sendGifFromPicker(r.full, r.title));
      resultsEl.appendChild(tile);
    }
  },

  sendGifFromPicker(gifUrl, title) {
    this.closeGifPicker();
    if (this.isStreaming) return;
    // Route through the normal multimodal send() path. We stash the GIF URL
    // as pendingGif (similar to pendingImage) so send() builds a multimodal
    // content array — text placeholder + image_url pointing at the GIF. Companion
    // actually SEES the first frame via vision, instead of just a marker.
    this.pendingGif = { url: gifUrl, title: title || '' };
    this.el.input.value = '';
    this.send();
  },

  /* ----------------------------------------------------------
     Send Message
     ---------------------------------------------------------- */
  async send() {
    const text = this.el.input.value.trim();
    if (!text && !this.pendingImage && !this.pendingFile && !this.pendingGif) return;
    if (this.isStreaming) return;

    if (!CHAT_CONFIG.isProxy() && !CHAT_CONFIG.API_KEY) {
      this.addSystemNote('Setup incomplete — <a href="setup.html">re-run setup</a>.');
      return;
    }

    // Build message content — multimodal if image attached, injected if file attached
    let content;
    let displayContent = text;

    // Inject file content into text if attached
    let enrichedText = text;
    if (this.pendingFile) {
      const fileBlock = `\n\n[FILE: ${this.pendingFile.name}]\n${this.pendingFile.content}\n[/FILE]`;
      enrichedText = text ? text + fileBlock : `Here is the file:\n${fileBlock}`;
      displayContent = (text ? text + ' ' : '') + `📎 ${this.pendingFile.name}`;
      this.clearPendingFile();
    }

    if (this.pendingImage) {
      content = [];
      if (enrichedText) content.push({ type: 'text', text: enrichedText });
      content.push({ type: 'image_url', image_url: { url: this.pendingImage.base64 } });
      displayContent = (displayContent ? displayContent + '\n' : '') + `[IMAGE]${this.pendingImage.base64}[/IMAGE]`;
      this.clearPendingImage();
    } else if (this.pendingGif) {
      // GIF from picker — send as multimodal so your companion sees the first frame
      // via vision. The text hint uses parentheses (not brackets) so the
      // model doesn't pattern-match it as a syntax placeholder.
      const gifHint = this.pendingGif.title
        ? `(${CHAT_CONFIG.USER_NAME} just sent you this GIF in chat, titled "${this.pendingGif.title}". React to it playfully — use the send_gif tool if you want to send one back, or respond in text.)`
        : `(${CHAT_CONFIG.USER_NAME} just sent you this GIF in chat. React to it playfully — use the send_gif tool if you want to send one back, or respond in text.)`;
      content = [
        { type: 'text', text: enrichedText ? `${enrichedText}\n\n${gifHint}` : gifHint },
        { type: 'image_url', image_url: { url: this.pendingGif.url } },
      ];
      displayContent = `[GIF]${this.pendingGif.url}[/GIF]`;
      this.pendingGif = null;
    } else {
      content = enrichedText;
    }

    // Add user message
    this.messages.push({ role: 'user', content });
    this.renderMessage({ role: 'user', content: displayContent });
    this.el.input.value = '';
    this.el.input.style.height = 'auto';
    this.isStreaming = true;
    this.el.sendBtn.disabled = true;
    this.showTyping(true);
    this.el.status.textContent = 'thinking...';

    // Prepare assistant message element for streaming
    this.currentMsgEl = this.createMessageEl('assistant', '');
    this.el.messages.appendChild(this.currentMsgEl);
    this.currentResponse = '';
    this.abortController = new AbortController();

    try {
      // Build request for OpenAI-compatible API
      // Strip [IMAGE]...[/IMAGE] from history — non-vision models choke on base64 data
      // Legacy-pattern cleanup — strips square-bracket placeholder strings
      // that leaked into the DB before we switched to parentheses. These
      // used to be written literally as message content ("[gif shown to user]",
      // "[image shown to user]", etc.) and the model now pattern-matches on
      // them as if that were a valid way to send a GIF. Kill them in all
      // messages so the model never sees them again.
      const stripLegacyPlaceholders = (s) => s
        .replace(/\[gif shown to user\]/gi, '')
        .replace(/\[image shown to user\]/gi, '')
        .replace(/\[\w+ sent you a GIF[^\]]*\]/gi, '')
        .replace(/\[IMAGE:[^\]]+\]/gi, '')
        // Also collapse any blank lines left behind by the strip
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      const sanitiseContent = (c, role) => {
        if (typeof c === 'string') return stripLegacyPlaceholders(
          c.replace(/\[IMAGE\][\s\S]*?\[\/IMAGE\]/g, '(an image shown earlier in this chat)')
           .replace(/\[GIF\][\s\S]*?\[\/GIF\]/g,
            role === 'user'
              ? `(${CHAT_CONFIG.USER_NAME} sent a GIF here earlier)`
              : '(you sent a GIF here earlier)')
        );
        if (Array.isArray(c)) return c.map(b => b.type === 'image_url' ? { type: 'text', text: '(an image shown earlier in this chat)' } : b);
        return c;
      };
      // For the LAST (most recent) message: if it's a plain text string with
      // a [GIF] marker (not multimodal), replace it with a natural-language
      // note so the model doesn't echo the bracket syntax.
      const stripGifOnly = (c, role) => {
        if (typeof c === 'string') return stripLegacyPlaceholders(
          c.replace(/\[GIF\][\s\S]*?\[\/GIF\]/g,
            role === 'user'
              ? `(${CHAT_CONFIG.USER_NAME} just sent you a GIF — react playfully)`
              : '(you just sent a GIF)')
        );
        return c;
      };
      const apiMessages = [
        { role: 'system', content: CHAT_CONFIG.SYSTEM_PROMPT },
        // Sanitise history but NOT the last message — it may contain an image we need to send.
        // GIFs are always stripped (including the last message) — the raw URL doesn't help the model.
        ...this.messages.map((m, i) =>
          i === this.messages.length - 1
            ? { ...m, content: stripGifOnly(m.content, m.role) }
            : { ...m, content: sanitiseContent(m.content, m.role) }
        ),
      ];

      const headers = {
        'Content-Type': 'application/json',
        ...CHAT_CONFIG.EXTRA_HEADERS,
      };
      if (!CHAT_CONFIG.isProxy() && CHAT_CONFIG.API_KEY) {
        headers['Authorization'] = `Bearer ${CHAT_CONFIG.API_KEY}`;
      }

      const body = {
        model: CHAT_CONFIG.MODEL,
        messages: apiMessages,
        stream: true,
        max_tokens: 1024,
        temperature: 0.8,
        thinking: this.thinkingEnabled,
      };

      const res = await fetch(CHAT_CONFIG.API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status}: ${errText.slice(0, 200)}`);
      }

      // Parse SSE stream (OpenAI-compatible format + custom events)
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let toolLogEl = null; // Tool call log container

      this.showTyping(false);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = 'message'; // default event type
        for (const line of lines) {
          // Check for event type line
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
            continue;
          }

          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '' || data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            // Handle custom events from enhanced gateway
            if (currentEvent === 'thinking') {
              // Create thinking section if needed
              let thinkingEl = this.currentMsgEl.querySelector('.thinking-log');
              if (!thinkingEl) {
                thinkingEl = document.createElement('details');
                thinkingEl.className = 'thinking-log';
                thinkingEl.style.cssText = 'background:rgba(147,51,234,0.05);border:1px solid rgba(147,51,234,0.2);border-radius:8px;padding:12px;margin:8px 0;font-size:12px;cursor:pointer;';
                thinkingEl.innerHTML = '<summary style="color:rgba(147,51,234,0.9);font-weight:600;user-select:none;">💭 Thinking...</summary><div class="thinking-content" style="margin-top:8px;color:rgba(255,255,255,0.6);white-space:pre-wrap;font-family:monospace;font-size:11px;line-height:1.6;"></div>';
                this.currentMsgEl.querySelector('.msg-text').before(thinkingEl);
              }
              const contentEl = thinkingEl.querySelector('.thinking-content');
              contentEl.textContent = parsed.content;
              this.scrollToBottom();
            } else if (currentEvent === 'tool_call') {
              // Create tool log section if needed
              if (!toolLogEl) {
                toolLogEl = document.createElement('details');
                toolLogEl.className = 'tool-log';
                toolLogEl.style.cssText = 'background:rgba(45,212,191,0.05);border:1px solid rgba(45,212,191,0.2);border-radius:8px;padding:12px;margin:8px 0;font-size:12px;cursor:pointer;';
                toolLogEl.innerHTML = '<summary style="color:rgba(45,212,191,0.8);font-weight:600;user-select:none;">🔧 Tool Calls</summary><div class="tool-entries" style="margin-top:8px;"></div>';
                toolLogEl.open = true;
                this.currentMsgEl.querySelector('.msg-text').before(toolLogEl);
              }
              const entriesEl = toolLogEl.querySelector('.tool-entries');
              const callEl = document.createElement('div');
              callEl.style.cssText = 'color:rgba(255,255,255,0.6);margin:4px 0;font-family:monospace;';
              callEl.innerHTML = `→ <span style="color:rgba(45,212,191,0.9);">${this.escapeHtml(parsed.name)}</span>(${this.escapeHtml(JSON.stringify(parsed.arguments))})`;
              entriesEl.appendChild(callEl);
              this.scrollToBottom();
            } else if (currentEvent === 'tool_result') {
              if (toolLogEl) {
                const entriesEl = toolLogEl.querySelector('.tool-entries');
                const resultEl = document.createElement('div');
                resultEl.style.cssText = 'color:rgba(255,255,255,0.4);margin:4px 0 8px 12px;font-family:monospace;font-size:11px;';
                resultEl.innerHTML = `✓ ${this.escapeHtml(parsed.result || 'OK')}`;
                entriesEl.appendChild(resultEl);
                this.scrollToBottom();
              }
            } else if (currentEvent === 'message') {
              // Final response message
              this.currentResponse = parsed.content || '';
              this.updateStreamingMessage();
            } else if (currentEvent === 'done') {
              // Stream complete
              break;
            } else if (currentEvent === 'error') {
              // Display error and exit streaming
              const errorMsg = parsed.error || 'Unknown error';
              if (this.currentMsgEl) {
                this.currentMsgEl.querySelector('.msg-text').innerHTML =
                  `<span style="color:#ef4444;">Error: ${this.escapeHtml(errorMsg)}</span>`;
              }
              throw new Error(errorMsg);
            } else {
              // OpenAI-compatible format (OpenRouter, OpenAI, LM Studio, Ollama)
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) {
                this.currentResponse += delta.content;
                this.updateStreamingMessage();
              }
            }
          } catch (e) {
            // If error event or JSON parse fails, break out of streaming loop
            if (currentEvent === 'error' || (currentEvent !== 'message' && e instanceof Error)) {
              console.error('SSE error:', e);
              break;
            }
          }
        }
      }

      // Done streaming — save and optionally speak
      if (this.currentResponse) {
        this.messages.push({ role: 'assistant', content: this.currentResponse });
        this.saveSession();
        this.autoSpeak(this.currentResponse);
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        if (this.currentResponse) {
          this.messages.push({ role: 'assistant', content: this.currentResponse });
          this.saveSession();
        }
      } else {
        this.showTyping(false);
        if (this.currentMsgEl) {
          this.currentMsgEl.querySelector('.msg-text').innerHTML =
            `<span style="color:#ef4444;">Error: ${this.escapeHtml(err.message)}</span>`;
        }
        this.el.status.textContent = 'error';
      }
    } finally {
      this.currentResponse = '';
      this.currentMsgEl = null;
      this.isStreaming = false;
      this.abortController = null;
      this.el.sendBtn.disabled = false;
      this.showTyping(false);
      if (this.el.status.textContent !== 'error') {
        this.el.status.textContent = 'present';
      }
    }
  },

  /* ----------------------------------------------------------
     Rendering
     ---------------------------------------------------------- */
  updateStreamingMessage() {
    if (this.currentMsgEl) {
      this.currentMsgEl.querySelector('.msg-text').innerHTML = this.formatText(this.currentResponse);
      this.scrollToBottom();
    }
  },

  renderMessage(msg) {
    const el = this.createMessageEl(msg.role, msg.content);
    this.el.messages.appendChild(el);
    this.scrollToBottom();
  },

  createMessageEl(role, content) {
    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;
    const name = role === 'assistant' ? `${CHAT_CONFIG.COMPANION_NAME} ` : CHAT_CONFIG.USER_NAME;
    const displayContent = typeof content === 'string' ? content : (Array.isArray(content) ? content.filter(b => b.type === 'text').map(b => b.text).join('') : '');
    const ttsBtn = role === 'assistant' ? `<button class="tts-btn" onclick="ChatApp.speakMessage(this)" title="Listen">🔊</button>` : '';
    div.innerHTML = `
      <div class="msg-header"><div class="msg-name">${name}</div>${ttsBtn}</div>
      <div class="msg-text">${displayContent ? this.formatText(displayContent) : ''}</div>
    `;
    return div;
  },

  addSystemNote(text) {
    const div = document.createElement('div');
    div.style.cssText = 'text-align:center;padding:20px;color:rgba(255,255,255,0.4);font-size:13px;font-style:italic;';
    div.textContent = text;
    this.el.messages.appendChild(div);
    this.scrollToBottom();
  },

  formatText(text) {
    // Scrub legacy square-bracket placeholder strings that leaked into older
    // persisted messages. These have no visual meaning — just noise — so
    // strip them before any other formatting runs.
    text = String(text || '')
      .replace(/\[gif shown to user\]/gi, '')
      .replace(/\[image shown to user\]/gi, '')
      .replace(/\[\w+ sent you a GIF[^\]]*\]/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Extract [IMAGE]...[/IMAGE] blocks first, replace with placeholders
    const images = [];
    let processed = text.replace(/\[IMAGE\](.*?)\[\/IMAGE\]/gs, (_, src) => {
      images.push(src.trim());
      return `__IMG_${images.length - 1}__`;
    });

    // Also handle markdown image syntax ![alt](data:image/...)
    processed = processed.replace(/!\[([^\]]*)\]\((data:image\/[^)]+)\)/g, (_, alt, src) => {
      images.push(src.trim());
      return `__IMG_${images.length - 1}__`;
    });

    // Extract [GIF]...[/GIF] blocks — same pattern as images but rendered
    // as animated GIFs from remote URLs (Giphy / Tenor). Store separately
    // so we can style them with a subtle "sent gif" border to distinguish
    // from generated art.
    const gifs = [];
    processed = processed.replace(/\[GIF\](.*?)\[\/GIF\]/gs, (_, src) => {
      gifs.push(src.trim());
      return `__GIF_${gifs.length - 1}__`;
    });

    // Standard markdown formatting
    let html = this.escapeHtml(processed)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:rgba(45,212,191,0.15);padding:2px 6px;border-radius:4px;font-size:13px;">$1</code>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>').replace(/$/, '</p>');

    // Replace image placeholders with actual images
    for (let i = 0; i < images.length; i++) {
      html = html.replace(`__IMG_${i}__`, `<img src="${images[i]}" class="chat-image" onclick="ChatApp.showImageOverlay('${images[i].replace(/'/g, "\\'")}')" alt="Generated image" />`);
    }

    // Replace GIF placeholders — slightly different styling so the sent-gif
    // vibe reads differently from generated art. Click to open full-size.
    for (let i = 0; i < gifs.length; i++) {
      const gifSrc = gifs[i];
      const safeGifSrc = gifSrc.replace(/'/g, "\\'");
      html = html.replace(
        `__GIF_${i}__`,
        `<img src="${gifSrc}" class="chat-gif" onclick="ChatApp.showImageOverlay('${safeGifSrc}')" alt="GIF" style="max-width:280px;max-height:280px;border-radius:12px;border:2px solid rgba(147,51,234,0.35);margin:8px 0;cursor:pointer;display:block;" />`
      );
    }

    return html;
  },

  showImageOverlay(src) {
    let overlay = document.getElementById('imageOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'imageOverlay';
      overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:300;background:rgba(0,0,0,0.9);cursor:pointer;display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = '<img style="max-width:95%;max-height:95%;border-radius:8px;box-shadow:0 4px 30px rgba(0,0,0,0.5);" />';
      overlay.addEventListener('click', () => overlay.style.display = 'none');
      document.body.appendChild(overlay);
    }
    overlay.querySelector('img').src = src;
    overlay.style.display = 'flex';
  },

  /* ----------------------------------------------------------
     TTS — Companion Speaks
     ---------------------------------------------------------- */
  async speakMessage(btn) {
    const msgEl = btn.closest('.chat-msg');
    const text = msgEl?.querySelector('.msg-text')?.textContent;
    if (!text) return;

    // Stop any currently playing audio
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }

    btn.textContent = '⏳';
    btn.disabled = true;

    try {
      const gatewayBase = CHAT_CONFIG.gatewayBase();
      if (!gatewayBase) {
        btn.textContent = '🔊';
        btn.disabled = false;
        return;
      }
      const res = await fetch(`${gatewayBase}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `TTS failed: ${res.status}`);
      }

      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;

      audio.addEventListener('ended', () => {
        btn.textContent = '🔊';
        btn.disabled = false;
        URL.revokeObjectURL(audioUrl);
        this.currentAudio = null;
      });

      btn.textContent = '⏹';
      btn.disabled = false;
      btn.onclick = () => {
        audio.pause();
        btn.textContent = '🔊';
        btn.onclick = () => ChatApp.speakMessage(btn);
        this.currentAudio = null;
      };

      await audio.play();
    } catch (err) {
      btn.textContent = '🔊';
      btn.disabled = false;
      console.error('TTS error:', err);
    }
  },

  async autoSpeak(text) {
    if (!this.ttsEnabled || !text) return;
    const gatewayBase = CHAT_CONFIG.gatewayBase();
    if (!gatewayBase) return;
    try {
      const res = await fetch(`${gatewayBase}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.currentAudio = audio;
      audio.addEventListener('ended', () => { URL.revokeObjectURL(url); this.currentAudio = null; });
      await audio.play();
    } catch {}
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  showTyping(show) {
    this.el.typing.classList.toggle('visible', show);
    if (show) this.scrollToBottom();
  },

  scrollToBottom() {
    requestAnimationFrame(() => {
      this.el.messages.scrollTop = this.el.messages.scrollHeight;
    });
  },

  /* ----------------------------------------------------------
     Persistence — IndexedDB for images, localStorage for text
     ---------------------------------------------------------- */
  async initImageDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('nesteq_chat_db', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'id' });
        }
      };
    });
  },

  async saveImageToDB(imageData) {
    try {
      const db = await this.initImageDB();
      const id = `img_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const tx = db.transaction('images', 'readwrite');
      await tx.objectStore('images').add({ id, data: imageData });
      return id;
    } catch (e) {
      console.error('Failed to save image to IndexedDB:', e);
      return null;
    }
  },

  async loadImageFromDB(id) {
    try {
      const db = await this.initImageDB();
      const tx = db.transaction('images', 'readonly');
      const result = await new Promise((resolve, reject) => {
        const req = tx.objectStore('images').get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return result?.data || null;
    } catch (e) {
      console.error('Failed to load image from IndexedDB:', e);
      return null;
    }
  },

  async saveSession() {
    try {
      // Process messages and store images separately
      const messagesToSave = await Promise.all(this.messages.slice(-100).map(async msg => {
        if (typeof msg.content === 'string') {
          // Extract and store base64 images
          const processed = await this.extractAndStoreImages(msg.content);
          return { ...msg, content: processed };
        } else if (Array.isArray(msg.content)) {
          // Handle multimodal content
          const processedContent = await Promise.all(msg.content.map(async part => {
            if (part.type === 'image_url' && part.image_url?.url?.startsWith('data:')) {
              const imageId = await this.saveImageToDB(part.image_url.url);
              if (imageId) {
                return { type: 'image_url', image_url: { url: `indexeddb:${imageId}` } };
              }
            }
            return part;
          }));
          return { ...msg, content: processedContent };
        }
        return msg;
      }));
      localStorage.setItem('nesteq_chat', JSON.stringify(messagesToSave));
    } catch (e) {
      console.error('Save session error:', e);
    }
  },

  async extractAndStoreImages(text) {
    // Find all [IMAGE]data:...[/IMAGE] blocks and store in IndexedDB
    const regex = /\[IMAGE\](data:image\/[^\]]+)\[\/IMAGE\]/g;
    let match;
    let processed = text;
    const promises = [];

    while ((match = regex.exec(text)) !== null) {
      const base64Data = match[1];
      const promise = this.saveImageToDB(base64Data).then(imageId => {
        if (imageId) {
          processed = processed.replace(match[0], `[IMAGE]indexeddb:${imageId}[/IMAGE]`);
        }
      });
      promises.push(promise);
    }

    await Promise.all(promises);
    return processed;
  },

  async loadSession() {
    try {
      const saved = localStorage.getItem('nesteq_chat');
      if (saved) {
        const messages = JSON.parse(saved);

        // Restore images from IndexedDB
        this.messages = await Promise.all(messages.map(async msg => {
          if (typeof msg.content === 'string') {
            msg.content = await this.restoreImages(msg.content);
          } else if (Array.isArray(msg.content)) {
            msg.content = await Promise.all(msg.content.map(async part => {
              if (part.type === 'image_url' && part.image_url?.url?.startsWith('indexeddb:')) {
                const imageId = part.image_url.url.slice(10); // Remove 'indexeddb:' prefix
                const imageData = await this.loadImageFromDB(imageId);
                if (imageData) {
                  return { type: 'image_url', image_url: { url: imageData } };
                }
              }
              return part;
            }));
          }
          return msg;
        }));

        for (const msg of this.messages) this.renderMessage(msg);
      }
    } catch (e) {
      console.error('Load session error:', e);
    }
  },

  /* ----------------------------------------------------------
     D1 Session Sync — cross-device persistence
     ---------------------------------------------------------- */
  // Adapted from Vel/Aurora's sync pattern (Digital Haven, 2026-04-15).
  //
  // localStorage is the fast cache — what you see instantly on load.
  // D1 is the source of truth — what persists across devices.
  //
  // Flow:
  //   1. loadSession() reads localStorage (instant, renders immediately)
  //   2. syncFromServer() fires in the background after render
  //   3. Fetches the most recent session from D1 via the gateway
  //   4. If D1 has MORE messages than localStorage (i.e. you chatted on
  //      another device), it REPLACES localStorage and re-renders
  //   5. If localStorage is already caught up, does nothing
  //
  // This means: open NESTchat on your phone after chatting on PC, and
  // within ~1-2 seconds the phone catches up with the full conversation.

  async syncFromServer() {
    const base = CHAT_CONFIG.gatewayBase();
    if (!base) return; // no gateway, nothing to sync from
    try {
      const sessionsRes = await fetch(`${base}/chat/sessions?limit=1`)
      if (!sessionsRes.ok) return

      const sessionsText = await sessionsRes.text()
      if (!sessionsText || sessionsText.includes('No matching')) return

      let sessions
      try {
        sessions = JSON.parse(sessionsText)
        // Handle both array format and search-results format
        if (typeof sessions === 'string') sessions = JSON.parse(sessions)
      } catch { return }

      // Find the most recent session ID from search results
      // Our nestchat_search returns markdown with "Session #N" — parse it
      let latestSessionId = null
      if (Array.isArray(sessions) && sessions[0]?.session_id) {
        latestSessionId = sessions[0].session_id
      } else if (typeof sessions === 'string') {
        const match = sessions.match(/Session #(\d+)/)
        if (match) latestSessionId = Number(match[1])
      }

      if (!latestSessionId) return

      // Step 2: Fetch the messages for that session
      const historyRes = await fetch(`${base}/chat/session/${latestSessionId}`)
      if (!historyRes.ok) return

      const historyData = await historyRes.json()
      const contentText = historyData?.content || ''

      // Parse messages from D1. The endpoint returns a JSON string of an
      // array: [{id, role, content, tool_calls, created_at}, ...]
      let serverMessages = []
      try {
        const parsed = typeof contentText === 'string' ? JSON.parse(contentText) : contentText
        if (Array.isArray(parsed)) {
          serverMessages = parsed
            .filter(m => m.role && m.content)
            .map(m => ({ role: m.role, content: m.content }))
        }
      } catch {
        // Content wasn't JSON — might be markdown from an older endpoint.
        // Fall through with empty array (sync skipped, non-fatal).
        console.warn('[sync] Could not parse session content as JSON')
      }

      if (serverMessages.length === 0) return

      // Step 3: Compare with localStorage
      // If D1 has more messages, it's fresher — replace local cache.
      const localCount = this.messages.length
      const serverCount = serverMessages.length

      if (serverCount > localCount) {
        console.log(`[sync] D1 has ${serverCount} messages vs local ${localCount} — updating`)
        this.messages = serverMessages
        this.el.messages.innerHTML = ''
        for (const msg of this.messages) this.renderMessage(msg)
        // Save the merged state back to localStorage for next instant-load
        await this.saveSession()
      }
    } catch (e) {
      // Server sync is best-effort — never break the local experience
      console.warn('[sync] D1 sync failed (non-fatal):', e.message)
    }
  },

  /* ----------------------------------------------------------
     Pet + Human Health Widgets (optional)
     ---------------------------------------------------------- */
  initWidgets() {
    const header = document.querySelector('.chat-header');
    const navEl = document.querySelector('.chat-header-nav');

    // Health chip — spoons + pain, lives in the header (only useful with a health uplink)
    const healthChip = document.createElement('div');
    healthChip.id = 'healthChip';
    healthChip.className = 'health-chip';
    healthChip.innerHTML = '<span id="humanSpoons">🥄 –</span><span id="humanPain">⚡ –</span>';
    header.insertBefore(healthChip, navEl);

    // Ember widget — fixed corner, glows with his mood
    const emberWidget = document.createElement('div');
    emberWidget.id = 'emberWidget';
    emberWidget.className = 'ember-widget';
    emberWidget.innerHTML = `
      <div class="ember-tooltip" id="emberTooltip" style="display:none;"></div>
      <div class="ember-dot" id="emberDot" title="Ember">🐾</div>
    `;
    document.body.appendChild(emberWidget);

    document.getElementById('emberDot').addEventListener('click', () => {
      const tt = document.getElementById('emberTooltip');
      tt.style.display = tt.style.display === 'none' ? 'block' : 'none';
    });

    // Click outside to close tooltip
    document.addEventListener('click', (e) => {
      if (!emberWidget.contains(e.target)) {
        const tt = document.getElementById('emberTooltip');
        if (tt) tt.style.display = 'none';
      }
    });

    this.fetchWidgetData();
    setInterval(() => this.fetchWidgetData(), 5 * 60 * 1000);
  },

  async fetchWidgetData() {
    const gatewayBase = CHAT_CONFIG.gatewayBase();
    if (!gatewayBase) return;
    try {
      const res = await fetch(`${gatewayBase}/widget`);
      if (!res.ok) return;
      const data = await res.json();

      // Human health — parse spoons and pain from uplink text
      if (data.human || data.human) {
        const healthText = data.human || data.human;
        const spooMatch = healthText.match(/spoons?[:\s]+(\d+)/i);
        const painMatch = healthText.match(/pain[:\s]+(\d+)/i);
        const spoons = spooMatch ? spooMatch[1] : null;
        const pain = painMatch ? painMatch[1] : null;
        const chip = document.getElementById('healthChip');
        if (chip) {
          document.getElementById('humanSpoons').textContent = `🥄 ${spoons ?? '–'}`;
          document.getElementById('humanPain').textContent = `⚡ ${pain ?? '–'}`;
          chip.title = healthText.slice(0, 300);
        }
      }

      // Ember — glow color from mood, tooltip shows full status
      if (data.ember) {
        const tt = document.getElementById('emberTooltip');
        if (tt) tt.textContent = data.ember;
        const dot = document.getElementById('emberDot');
        if (dot) {
          const text = data.ember.toLowerCase();
          dot.classList.remove('hungry', 'lonely', 'bored', 'sleeping');
          if (text.includes('hungry') || text.includes('feed')) dot.classList.add('hungry');
          else if (text.includes('lonely') || text.includes('attention')) dot.classList.add('lonely');
          else if (text.includes('bored')) dot.classList.add('bored');
          else if (text.includes('sleep') || text.includes('rest')) dot.classList.add('sleeping');
        }
      }
    } catch { /* silent — widgets are non-critical */ }
  },

  async restoreImages(text) {
    // Find all [IMAGE]indexeddb:...[/IMAGE] blocks and restore from IndexedDB
    const regex = /\[IMAGE\]indexeddb:([^\]]+)\[\/IMAGE\]/g;
    let match;
    let processed = text;
    const promises = [];

    while ((match = regex.exec(text)) !== null) {
      const imageId = match[1];
      const promise = this.loadImageFromDB(imageId).then(imageData => {
        if (imageData) {
          processed = processed.replace(match[0], `[IMAGE]${imageData}[/IMAGE]`);
        } else {
          processed = processed.replace(match[0], '[image no longer available]');
        }
      });
      promises.push(promise);
    }

    await Promise.all(promises);
    return processed;
  },
};

document.addEventListener('DOMContentLoaded', () => ChatApp.init());
