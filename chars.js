/* 七個造型。**名單來自正篇的七個角色，不是隨便挑的。**
 * 立繪是 glitch-vn/art/sprite-*.png 裁掉透明邊、統一高度 512 之後轉的 webp。
 *
 * `tint` 是蛋殼的顏色，照每個人在正篇裡的色調給，玩家看蛋就猜得到是誰。
 * `rare` 只影響出現機率的權重，不影響玩法——這一款沒有付費，稀有度純粹是節奏。
 */
export const CHARS = [
  { id: "glitch",    name: "格莉奇",   tint: 0xb9a7ec, rare: 1, line: "逼——嗶！是我。" },
  { id: "catgrass",  name: "貓草",     tint: 0x8fbf7a, rare: 1, line: "喔，是我啊。" },
  { id: "bambi",     name: "斑比",     tint: 0xe2a6b8, rare: 1, line: "……這個有畫我？" },
  { id: "noah",      name: "諾亞",     tint: 0xc9a06a, rare: 1, line: "這個做得不錯。" },
  { id: "tower",     name: "鐵塔",     tint: 0x7fa8c9, rare: 2, line: "這是授權商品嗎。" },
  { id: "zerox",     name: "0x",       tint: 0x6f7480, rare: 3, line: "……為什麼有我。" },
  { id: "blackhole", name: "黑洞先生", tint: 0x4a4550, rare: 4, line: "嗯。" },
];

/** 依權重抽一個。權重是 1/rare：黑洞先生最難轉到。 */
export function roll() {
  const w = CHARS.map(c => 1 / c.rare);
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < CHARS.length; i++) {
    r -= w[i];
    if (r <= 0) return CHARS[i];
  }
  return CHARS[CHARS.length - 1];
}
