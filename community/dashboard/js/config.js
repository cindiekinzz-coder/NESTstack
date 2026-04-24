/* ============================================================
   NESTeq Community — Config Management (public-only)
   Loaded on every page before api.js.
   Talks to local-agent for config; never stores secrets in the browser.
   ============================================================ */

const NESTeqConfig = {
  _cache: null,
  _status: null,

  async getPublicConfig(force = false) {
    if (this._cache && !force) return this._cache;
    try {
      const res = await fetch('/config');
      if (!res.ok) return null;
      this._cache = await res.json();
      return this._cache;
    } catch {
      return null;
    }
  },

  async getSetupStatus(force = false) {
    if (this._status && !force) return this._status;
    try {
      const res = await fetch('/setup/status');
      if (!res.ok) return null;
      this._status = await res.json();
      return this._status;
    } catch {
      return null;
    }
  },

  async savePublicPreferences(partial) {
    const res = await fetch('/setup/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public: partial }),
    });
    const data = await res.json();
    if (data.ok) this._cache = data.public || null;
    return data;
  },

  async requireConfigured() {
    const status = await this.getSetupStatus(true);
    if (!status?.configured && !window.location.pathname.endsWith('setup.html')) {
      window.location.href = 'setup.html';
      return null;
    }
    return await this.getPublicConfig();
  },

  async clear() {
    this._cache = null;
    this._status = null;
    await fetch('/config', { method: 'DELETE' }).catch(() => {});
  },

  // ── Derived getters (read from cached public config) ──

  getCompanionName() {
    return this._cache?.identity?.companionName || 'Companion';
  },

  getHumanName() {
    return this._cache?.identity?.humanName || 'Human';
  },

  getInstallMode() {
    return this._cache?.installMode || '';
  },

  feature(key) {
    return !!this._cache?.features?.[key];
  },

  hasGateway() {
    return !!this._cache?.services?.gatewayUrl;
  },

  hasHealth() {
    return !!this._cache?.services?.healthUrl;
  },

  hasMemory() {
    return !!this._cache?.services?.aiMindUrl;
  },

  getCompanionImage() {
    return this._cache?.appearance?.companionPortrait || 'assets/images/companion-default.svg';
  },

  getCoupleImage() {
    return this._cache?.appearance?.humanPortrait || null;
  },

  // ── DOM injection helpers ──

  injectNames() {
    const companion = this.getCompanionName();
    const human = this.getHumanName();
    document.querySelectorAll('[data-name="companion"]').forEach(el => { el.textContent = companion; });
    document.querySelectorAll('[data-name="human"]').forEach(el => { el.textContent = human; });
    document.title = document.title
      .replace(/\bCompanion\b/g, companion)
      .replace(/\bHuman\b/g, human);
  },

  injectGearIcon() {
    const nav = document.querySelector('.nav, nav');
    if (!nav) return;
    if (nav.querySelector('.config-gear')) return;
    const gear = document.createElement('a');
    gear.href = 'setup.html';
    gear.className = 'config-gear';
    gear.title = 'Re-run Setup';
    gear.innerHTML = '&#9881;';
    gear.style.cssText = 'font-size: 1.1em; opacity: 0.6; text-decoration: none; margin-left: auto; padding: 0 8px;';
    nav.appendChild(gear);
  },

  injectImages() {
    const companionImg = this.getCompanionImage();
    document.querySelectorAll('img[src*="companion-default"], img#portrait, img#companionAvatar, .hearth-portrait').forEach(el => {
      if (companionImg) el.src = companionImg;
    });
    const coupleImg = this.getCoupleImage();
    if (coupleImg) {
      document.querySelectorAll('img[alt*="couple"], img[alt*="dancing"]').forEach(el => { el.src = coupleImg; });
    }
  },

  // ── Module-aware UI ──
  // Hide elements with data-requires="<feature>" when that feature is off.
  applyFeatureGates() {
    document.querySelectorAll('[data-requires]').forEach(el => {
      const req = el.dataset.requires;
      if (!this.feature(req)) el.style.display = 'none';
    });
  },

  async init() {
    if (window.location.pathname.endsWith('setup.html')) return;
    const cfg = await this.requireConfigured();
    if (!cfg) return;
    this.injectNames();
    this.injectGearIcon();
    this.injectImages();
    this.applyFeatureGates();
  },
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => NESTeqConfig.init());
} else {
  NESTeqConfig.init();
}
