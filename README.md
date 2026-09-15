# 格莉奇遊樂園・扭蛋機

`glitch-park-gacha` — 《格莉奇與黑洞先生》調查篇裡「格莉奇遊樂園」的第一個小遊戲。
與正篇劇情無關，是掛在調查板上一個常駐開放的地點；玩家投幣、轉把手、開蛋，
轉出正篇七個角色其中一個的紙板立牌。

three.js，全部用基本幾何體組場景，沒有外部 3D 模型檔；角色是把正篇的透明底立繪
做成有厚度的紙板立牌（同一張圖畫兩次、染成紙板色、往後挪一點）。零建置步驟，
`index.html` 直接開就能跑。

## 玩

<https://yazelin.github.io/glitch-park-gacha/>

流程：投幣 → 轉把手 → 蛋掉下來 → 點蛋 → 打開 → 立牌從蛋殼站起來，全螢幕壓黑、
放射光、星星愛心，收集架記住轉到過誰。

## 本機跑

```
python3 -m http.server 8000
```

再開 `http://localhost:8000/`。不需要 npm install，`vendor/` 已經帶了
`three.module.min.js`。

## 存檔

`store.js` 有兩條路：獨立開網頁用 `localStorage`；之後嵌進 Larch 的小遊戲卡
（`srcdoc` + `sandbox="allow-scripts"`，opaque origin，`localStorage` 會直接丟
`SecurityError`）時改用 `postMessage` 跟外層（Larch 的變數）交換狀態。兩種情況
遊戲本體呼叫的是同一組介面，不必知道自己在哪裡跑。

## 這是「格莉奇遊樂園」系列的第一個

調查篇地圖上會有一個不受劇情解鎖限制、24 小時開著的地點「格莉奇遊樂園」，
裡面有幾款各自獨立開發、獨立 repo、獨立 GitHub Pages 的小遊戲，調查板用 iframe
把它們嵌進去。這一支是扭蛋機；下一支是抓娃娃機（夾正篇角色的週邊），
再下一支是拉霸機（拉到 777 得格莉奇抱枕 CG）。

## 授權

角色與美術素材出自《格莉奇與黑洞先生》，版權保留。程式碼另計。
