/* 存檔。**同一份程式要能在兩個地方跑，而那兩個地方的存檔方式不一樣。**
 *
 *   單獨開 GitHub Pages     → 一般網頁，localStorage 可以用
 *   嵌進 Larch 的小遊戲卡   → srcdoc + sandbox="allow-scripts"，opaque origin，
 *                            **localStorage 一碰就丟 SecurityError**
 *                            （2026-09-15 在本機重現同一組條件量到的，不是猜的）
 *
 * 所以這一層做兩件事：能用就用 localStorage；不能用就把狀態 postMessage 給外層，
 * 由 Larch 的變數存。兩邊的介面一樣，遊戲本體不必知道自己在哪裡跑。
 */
const KEY = "glitch-park-gacha";

function probe() {
  try {
    localStorage.setItem(KEY + ":probe", "1");
    localStorage.removeItem(KEY + ":probe");
    return true;
  } catch (e) {
    return false;           // opaque origin、無痕視窗、瀏覽器擋網站資料
  }
}

export const Store = {
  local: probe(),
  data: { owned: [], plays: 0 },

  async load() {
    if (this.local) {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) this.data = { ...this.data, ...JSON.parse(raw) };
      } catch (e) { /* 壞掉的 JSON 當沒存過 */ }
      return this.data;
    }
    // 外層（Larch 卡）回一份狀態給我們。等不到就當第一次玩。
    return new Promise(resolve => {
      const t = setTimeout(() => { window.removeEventListener("message", on); resolve(this.data); }, 1200);
      const on = ev => {
        if (!ev.data || ev.data.type !== "gacha:state") return;
        clearTimeout(t);
        window.removeEventListener("message", on);
        if (ev.data.state) this.data = { ...this.data, ...ev.data.state };
        resolve(this.data);
      };
      window.addEventListener("message", on);
      parent.postMessage({ type: "gacha:ready" }, "*");
    });
  },

  save() {
    if (this.local) {
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* 滿了就算了 */ }
      return;
    }
    parent.postMessage({ type: "gacha:save", state: this.data }, "*");
  },

  own(id) {
    const first = !this.data.owned.includes(id);
    if (first) this.data.owned.push(id);
    this.data.plays++;
    this.save();
    return first;
  },
};
