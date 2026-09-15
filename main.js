/* 扭蛋機。three.js，場景全部由基本幾何體組出來，沒有外部模型檔。
 *
 * **角色是紙板立牌，不是 3D 模型。** 我們手上只有七張透明底立繪
 * （正篇的 sprite-*.png）。硬要生七個模型，一致性守不住；做成立在座子上的
 * 紙板人反而跟正篇的母題對得上——便利商店那個紙板人形就是這樣站著的。
 * 厚度用「同一張圖再畫一次、往後挪一點點、染成紙板色」做出來，
 * 兩片之間那條邊看起來就是紙的斷面。
 *
 * 流程是一條線：投幣 → 轉把手 → 蛋掉下來 → 點蛋 → 打開 → 紙板人立起來。
 * 每一段都是時間驅動的，沒有物理引擎——蛋的路徑是寫死的三段曲線，
 * 因為這裡要的是「每次都好看」，不是「每次都不一樣」。
 */
import * as THREE from "./vendor/three.module.min.js";
import { CHARS, roll } from "./chars.js";
import { Store } from "./store.js";

// ── 配色 ────────────────────────────────────────────────────────────────
// **取自格莉奇的正典三視圖**（淡紫藍短髮、薰衣草連帽衫、深紫百褶裙與過膝襪、
// 髮飾與領環上的青色像素光、白紫厚底鞋）。整個遊樂園都用她的色票，
// 所以玩家一進來就知道這是誰的地盤——機台、地板、燈光都算在內。
const PAL = {
  hair:   0xc2cbef,   // 髮 淡紫藍
  hoodie: 0xe3dff4,   // 連帽衫 薰衣草白
  skirt:  0x453a5e,   // 裙／襪 深紫
  violet: 0x9b7fd4,   // 主紫
  mint:   0x8de8e0,   // 像素光 青
  pink:   0xd9b8f0,   // 粉紫
  shoe:   0xf6f4fb,   // 鞋 白
  floor:  0xd7d1ea,   // 地板 淡紫
  floor2: 0xe9e3d4,   // 地板格子（暖米，不要用純白，整片會刺眼）
  sky:    0xeceaf7,   // 天／背景
  // ── 互補色 ──────────────────────────────────────────────
  // **一整片紫青看久了會累。** 紫的補色在黃橘那一帶，青的補色在珊瑚紅。
  // 用量刻意壓小：只出現在燈、獎品、招牌邊、幾台背景機——
  // 冷色仍然是主調，暖色只負責讓眼睛有地方休息。
  amber:  0xf2c46b,   // 暖 琥珀
  apricot:0xf3a97e,   // 暖 杏
  coral:  0xe8806f,   // 暖 珊瑚（最少量，只點在重點上）
};

const el = id => document.getElementById(id);
const hint = el("hint"), go = el("go"), shelf = el("shelf"), reveal = el("reveal");
const collection = el("collection"), collectionList = el("collectionList"), collectionClose = el("collectionClose");
const muteBtn = el("mute");

// 一張中心亮、邊緣透明的圓形漸層，光暈與地上的光池都用它
const GLOW = (function () {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// ── 讓每一樣東西的完成度對齊 ────────────────────────────────────────────
// **一個部位做得比別的細，整體反而更假。** 罩子換成會折射的玻璃之後，
// 旁邊那些純色方盒就顯得像紙糊的——本人的原話是「玻璃感提升，其他沒提升，
// 反而非常怪」。所以這一節做的是把其餘部分拉到同一條線上：
//   一、盒子要有倒角。現實裡沒有絕對銳利的邊，那條高光就是「這是實物」的訊號。
//   二、表面要有微觀變化。完全均勻的粗糙度會讓高光像貼紙。
//   三、物體與地面接觸的地方要暗下去。少了它，東西看起來是浮著的。

/** 有倒角的盒子。core 沒有 RoundedBoxGeometry，用 Shape + Extrude 的倒角做。 */
function roundedBox(w, h, d, r = 0.06) {
  const sh = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  sh.moveTo(x + r, y);
  sh.lineTo(x + w - r, y);      sh.quadraticCurveTo(x + w, y, x + w, y + r);
  sh.lineTo(x + w, y + h - r);  sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  sh.lineTo(x + r, y + h);      sh.quadraticCurveTo(x, y + h, x, y + h - r);
  sh.lineTo(x, y + r);          sh.quadraticCurveTo(x, y, x + r, y);
  const b = Math.min(r * 0.7, d * 0.22);
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: d - b * 2, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 8 });
  g.translate(0, 0, -(d - b * 2) / 2);
  g.computeVertexNormals();
  return g;
}

/** 微觀粗糙度。高光不再像貼紙，而是有一點呼吸。 */
const ROUGH = (function () {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d");
  const img = x.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 168 + Math.random() * 46;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
})();

// 接觸陰影專用的貼圖：中心是不透明的暗紫，往外淡出到全透明。
// **不可以拿 GLOW 來用。** 那張是中心全白的，配乘法混色等於在地上貼一塊白斑
// （第一版就是這樣，六台機器腳下各一塊白方塊）。
const SHADE = (function () {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, "rgba(46,38,72,.62)");
  g.addColorStop(0.55, "rgba(46,38,72,.26)");
  g.addColorStop(1, "rgba(46,38,72,0)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

/** 接觸陰影。真的算 AO 太貴，貼一張壓扁的漸層在腳下，東西就「落地」了。 */
function contact(obj, w, d, o = 0.42) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: SHADE, transparent: true, opacity: o,
      depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.006;
  obj.add(m);
  return m;
}

// 會被「壓黑」調暗的燈。**獎品要跳出來，靠的是旁邊暗下去，不是它自己變亮。**
const DIMMABLE = [];

// ── 場景 ────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(PAL.sky);
scene.fog = new THREE.Fog(PAL.sky, 11, 24);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 2.5, 7.4);
camera.lookAt(0, 1.55, -0.6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// **色調映射是質感差最多的一個開關。** 預設的 NoToneMapping 會把亮部直接夾掉，
// 燈泡跟招牌變成一片死白；ACES 把高光壓成有層次的滾降，整個畫面立刻像拍出來的
// 而不是算出來的。曝光稍微壓低一點，留住亮部的細節。
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// **貼圖載入器要早於用到它的人。** 遊樂園那一段會載海報用的立繪，
// 宣告放在紙板立牌那一節的話，它在場景建好之前還沒初始化。
const loader = new THREE.TextureLoader();

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  const tall = w / h < 0.8;
  // **窄視窗（多半是手機）把像素比例壓低一點。** 全螢幕 3D 加上陰影、
  // 加法混色的光效，在真手機的 DPR 3 螢幕上全速算會發燙、降頻。
  // 這裡不是猜的機海資料，是常見的手機安全上限——這個場景沒有細字要辨識，
  // 犧牲一點銳利度換流暢度划算。
  renderer.setPixelRatio(Math.min(devicePixelRatio, tall ? 1.5 : 2));
  camera.aspect = w / h;
  camBase.set(0, tall ? 2.7 : 2.5, tall ? 9.2 : 7.4);
  camAim.set(0, tall ? 1.7 : 1.55, -0.6);
  camera.position.copy(camBase);
  camera.fov = tall ? 48 : 40;
  camera.lookAt(camAim);
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

// **鏡頭要會動一點點。** 完全固定的鏡頭看起來像一張圖；跟著指標偏一兩度、
// 再疊一個很慢的呼吸，畫面就變成「有人站在那裡看」。幅度刻意很小，
// 大了會暈，也會讓點擊判定跟視覺對不上。
const look = { x: 0, y: 0, tx: 0, ty: 0 };
addEventListener("pointermove", e => {
  look.tx = (e.clientX / innerWidth - 0.5) * 2;
  look.ty = (e.clientY / innerHeight - 0.5) * 2;
});
let camBase = new THREE.Vector3(), camAim = new THREE.Vector3();

// **金屬一定要有環境貼圖，不然是全黑的。** MeshStandardMaterial 的金屬度越高，
// 顏色越是從環境反射來的；只有方向光而沒有環境時，metalness 0.75 的金箍會
// 算出一片近乎黑的東西——第一版的把手就是這樣變成一塊黑餅的。
// 這裡不載 HDR，用一張上亮下暗的漸層當環境，PMREM 濾一遍就夠亮出金屬感。
(function environment() {
  const c = document.createElement("canvas");
  c.width = 32; c.height = 64;
  const g = c.getContext("2d").createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, "#f2f0fb");     // 天
  g.addColorStop(0.5, "#cfc8e8");
  g.addColorStop(1, "#a9a0cc");     // 地
  const ctx = c.getContext("2d");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose(); tex.dispose();
})();



const hemi = new THREE.HemisphereLight(0xf2f0fb, PAL.floor2, 2.2);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfffaf0, 2.4);
key.position.set(3.2, 6, 4.5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = key.shadow.camera.bottom = -5;
key.shadow.camera.right = key.shadow.camera.top = 5;
scene.add(key);
const rim = new THREE.DirectionalLight(PAL.mint, 1.2);
rim.position.set(-4, 2.4, -3);
scene.add(rim);
// 機台上方那盞：讓罩子裡的蛋亮起來，遊樂園的燈就是要打在商品上
const spot = new THREE.SpotLight(0xffffff, 26, 9, 0.62, 0.5, 1.6);
spot.position.set(0, 4.6, 1.6);
spot.target.position.set(0, 1.4, 0);
spot.castShadow = true;
spot.shadow.mapSize.set(1024, 1024);
scene.add(spot, spot.target);
DIMMABLE.push(hemi, key, rim, spot);
// 地上的光池。真的算 IBL 太貴，貼一張加法漸層就有「聚光燈打在這裡」的樣子。
const pool = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6),
  new THREE.MeshBasicMaterial({ map: GLOW, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false }));
pool.rotation.x = -Math.PI / 2;
pool.position.set(0, 0.012, 0.3);
scene.add(pool);

// 地板的棋盤格畫在 canvas 上。**格子要淡**，它是地板不是主角。
const floorTex = (function () {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  x.fillStyle = "#" + PAL.floor.toString(16).padStart(6, "0");
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = "#" + PAL.floor2.toString(16).padStart(6, "0");
  x.fillRect(0, 0, 64, 64); x.fillRect(64, 64, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(11, 56),
  // 地板略帶反光：遊樂園的地是擦過的，會把燈映出來一點
  new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.42, roughnessMap: ROUGH,
    metalness: 0.06, color: 0xe6e2f0, envMapIntensity: 0.55 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// ── 機台 ────────────────────────────────────────────────────────────────
const machine = new THREE.Group();
machine.scale.setScalar(0.92);   // 比立牌讓一點，不然公仔永遠看起來很小
scene.add(machine);
contact(machine, 3.1, 3.1, 0.5);

const body = new THREE.Mesh(
  roundedBox(1.5, 1.5, 1.2, 0.09),
  new THREE.MeshStandardMaterial({ color: PAL.hoodie, roughness: 0.42, metalness: 0.06,
    roughnessMap: ROUGH, envMapIntensity: 0.9 }));
body.name = 'body';
body.position.y = 0.75;
body.castShadow = body.receiveShadow = true;
machine.add(body);

const skirt = new THREE.Mesh(
  roundedBox(1.62, 0.16, 1.32, 0.04),
  new THREE.MeshStandardMaterial({ color: PAL.skirt, roughness: 0.62, roughnessMap: ROUGH,
    metalness: 0.15, envMapIntensity: 0.8 }));
skirt.position.y = 0.08;
skirt.castShadow = true;
machine.add(skirt);

// 取物口：往內凹的一個洞
const mouth = new THREE.Mesh(
  roundedBox(0.72, 0.42, 0.34, 0.05),
  new THREE.MeshStandardMaterial({ color: 0x2a2340, roughness: 1 }));
mouth.position.set(0, 0.46, 0.5);
machine.add(mouth);
const lip = new THREE.Mesh(
  new THREE.BoxGeometry(0.84, 0.06, 0.1),
  new THREE.MeshStandardMaterial({ color: PAL.amber, roughness: 0.4, metalness: 0.25 }));
lip.position.set(0, 0.24, 0.62);
machine.add(lip);

// 玻璃罩：半球 + 一圈金屬箍
const dome = new THREE.Mesh(
  new THREE.SphereGeometry(0.86, 40, 28, 0, Math.PI * 2, 0, Math.PI / 2),
  // **玻璃用 transmission，不要用 opacity。** 半透明只是把後面的東西調淡，
  // transmission 會真的折射——裡面那堆蛋的邊緣會被罩子拉彎，那一點彎就是
  // 「這是一塊玻璃」跟「這是一層霧」的差別。只有這一個物件用，不心疼。
  new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.04, metalness: 0,
    transmission: 1, thickness: 0.35, ior: 1.46,
    side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.03,
    envMapIntensity: 1.4, transparent: true, opacity: 1 }));
dome.name = 'dome';
dome.position.y = 1.5;
machine.add(dome);
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(0.86, 0.055, 12, 48),
  new THREE.MeshStandardMaterial({ color: PAL.violet, roughness: 0.3, metalness: 0.65 }));
ring.name = 'metal';
ring.rotation.x = Math.PI / 2;
ring.position.y = 1.5;
machine.add(ring);

// 罩子裡的蛋堆：不會動，堆在球底
const capMat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.32, metalness: 0.05 });
const heap = new THREE.Group();
heap.position.y = 1.5;   // 罩子底面
machine.add(heap);
// **罩子裡的蛋是裝飾，用店的色票，不要用角色色。** 角色色裡有灰有褐
// （0x、黑洞先生、諾亞），混在粉紫裡會髒掉。真正代表角色的是轉出來那一顆。
const DECO = [PAL.violet, PAL.mint, PAL.pink, PAL.hair, PAL.hoodie, PAL.shoe];
const BALL_R = 0.14, DOME_R = 0.86, MARGIN = 0.03;   // 罩子內半徑扣掉安全間隙
for (let i = 0; i < 34; i++) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 18, 14), capMat(DECO[i % DECO.length]));
  const r = 0.66 * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
  // **之前只擋了「正上方的天花板」，沒擋「旁邊的弧面」。** 圓球中心到罩頂的
  // 垂直淨空用 √(R²−r²) 算沒錯，可是那只保證球不會從正上方戳穿；水平半徑
  // 到 0.66（球半徑 0.14）的球，中心 3D 距離其實逼近球心 0.86 那圈，
  // 從側邊斜斜戳出玻璃——本人回報「轉蛋有一點點露出來」，肉眼看到的就是這個。
  // 正確做法是整顆球（中心＋半徑）都要落在罩子球面以內：
  //   √(r² + y²) + 球半徑 ≤ 罩子半徑 − 安全間隙
  const yMax = Math.sqrt(Math.max((DOME_R - BALL_R - MARGIN) ** 2 - r * r, 0));
  m.position.set(Math.cos(a) * r, 0.02 + Math.random() * Math.max(yMax - 0.02, 0.05), Math.sin(a) * r);
  m.castShadow = true;
  heap.add(m);
}

// 正面的招牌。文字畫在 canvas 上當貼圖——這是唯一不用額外檔案就能放中文的做法。
(function sign() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 160;
  const x = c.getContext("2d");
  x.fillStyle = "#f6f4fb"; x.fillRect(0, 0, 512, 160);
  x.fillStyle = "#8de8e0"; x.fillRect(0, 0, 512, 10);
  x.fillStyle = "#f2c46b"; x.fillRect(0, 150, 512, 10);
  x.fillStyle = "#453a5e";
  x.font = "600 54px 'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif";
  x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText("格莉奇遊樂園", 256, 74);
  x.font = "400 22px system-ui,sans-serif";
  x.fillStyle = "#c98a3c";
  x.fillText("GACHA  一枚代幣", 256, 122);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.34),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
  board.name = 'sign';
  board.position.set(0, 1.28, 0.605);
  machine.add(board);
})();

// 把手
const crank = new THREE.Group();
crank.position.set(-0.16, 0.9, 0.62);
machine.add(crank);
const plate = new THREE.Mesh(
  new THREE.CylinderGeometry(0.2, 0.2, 0.06, 28),
  new THREE.MeshStandardMaterial({ color: PAL.violet, roughness: 0.25, metalness: 0.7 }));
plate.name = 'metal';
plate.rotation.x = Math.PI / 2;
plate.castShadow = true;
crank.add(plate);
// **把手要看得出來能轉。** 第一版是一塊貼在面板上的薄片，玩家看到的是一個黑餅。
// 改成往外伸的搖桿：一根橫桿加一顆握球，側光一打就有立體感。
const arm = new THREE.Mesh(
  new THREE.BoxGeometry(0.3, 0.06, 0.06),
  new THREE.MeshStandardMaterial({ color: PAL.skirt, roughness: 0.4, metalness: 0.3 }));
arm.position.set(0.08, 0, 0.1);
crank.add(arm);
const knob = new THREE.Mesh(
  new THREE.SphereGeometry(0.075, 20, 14),
  new THREE.MeshStandardMaterial({ color: PAL.mint, roughness: 0.25, metalness: 0.15 }));
knob.position.set(0.22, 0, 0.14);
knob.castShadow = true;
crank.add(knob);

// 投幣孔
// 投幣孔。**要點得到，所以判定用外框那塊金屬板，不是那條細縫。**
const bezel = new THREE.Mesh(
  roundedBox(0.3, 0.2, 0.05, 0.02),
  new THREE.MeshStandardMaterial({ color: PAL.violet, roughness: 0.25, metalness: 0.8 }));
bezel.position.set(0.5, 0.93, 0.61);
machine.add(bezel);
const slot = new THREE.Mesh(
  new THREE.BoxGeometry(0.17, 0.035, 0.05),
  new THREE.MeshStandardMaterial({ color: 0x0d0b12, roughness: 1 }));
slot.position.set(0.5, 0.96, 0.63);
machine.add(slot);

// **投幣要看得到一枚金幣飛進去，不能只是狀態切換。** 一片很薄的圓柱體，
// 從手邊的位置飛向投幣孔，快到孔的時候縮小＋立起來，看起來像側身滑進縫裡。
// **變數不能叫 coin。** 底下的投幣按鈕處理函式就叫 coin()，同名會炸。
// **第一版半徑 0.09、純 PBR 反光，量出來完全看不見**——用一顆放大三倍、
// 純色的除錯球比對過，才確定不是位置或遮擋的問題，是這顆真的太小太暗。
// 場景裡連公仔都做到 1.8 高的誇張比例，金幣也該比寫實尺寸大一截才鎮得住。
const coinMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(0.16, 0.16, 0.022, 28),
  new THREE.MeshStandardMaterial({ color: PAL.amber, roughness: 0.18, metalness: 0.8,
    roughnessMap: ROUGH, envMapIntensity: 1.4,
    emissive: PAL.amber, emissiveIntensity: 0.35 }));   // 帶一點自發光，側面轉到看不到反光時也不會整個消失
coinMesh.rotation.x = Math.PI / 2;   // 扁面朝向玩家，好認得那是一枚錢幣
coinMesh.visible = false;
coinMesh.castShadow = true;
machine.add(coinMesh);
const COIN_FROM = new THREE.Vector3(1.1, 1.25, 1.3);          // 從手邊的方向飛出來
const COIN_TO = new THREE.Vector3(0.5, 0.96, 0.63);            // 投幣孔
let coinT = null;   // null＝沒有動畫在跑；0→1 是動畫進度

function coinFly() {
  coinT = 0;
  coinMesh.visible = true;
  coinMesh.position.copy(COIN_FROM);
  coinMesh.scale.setScalar(1);
}

// ── 遊樂園本體 ──────────────────────────────────────────────────────────
// **主角機台外面要有一間店。** 只放一台機台的話，玩家看到的是一個道具，
// 不是一個地方；而板上那一格賣的是「可以去的地方」。
// 背景那幾台是主角機台 clone 出來的（材質要各自 clone，不然改一台全部變色），
// 站遠、站暗、不參與互動，只負責讓這裡看起來像一整排扭蛋機。
(function arcade() {
  const M = (c, r = 0.7, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });

  // 牆：三面圍起來，玩家的視角只看得到後面與兩側
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xcfc8e8, roughness: 0.88,
    roughnessMap: ROUGH, envMapIntensity: 0.5 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(26, 7), wallMat);
  back.position.set(0, 3.5, -7);
  back.receiveShadow = true;
  scene.add(back);
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), wallMat);
    w.position.set(sx * 9, 3.5, -0.5);
    w.rotation.y = -sx * Math.PI / 2;
    scene.add(w);
  }
  // 牆腳的深紫踢腳板，呼應她的裙襪
  const skirting = new THREE.Mesh(new THREE.BoxGeometry(26, 0.34, 0.12), M(PAL.skirt, 0.6));
  skirting.position.set(0, 0.17, -6.94);
  scene.add(skirting);

  // 天花板與吊燈
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(26, 16), M(0xe8e4f5, 0.95));
  ceil.position.set(0, 6.4, -1);
  ceil.rotation.x = Math.PI / 2;
  scene.add(ceil);
  for (const x of [-4.4, 0, 4.4]) {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.62, 0.3, 20),
      new THREE.MeshStandardMaterial({ color: 0xfffdf6, emissive: 0xfff6dd, emissiveIntensity: 1.4, roughness: 0.6 }));
    lamp.position.set(x, 5.5, -1.6);
    scene.add(lamp);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8), M(PAL.skirt, 0.5, 0.4));
    rod.position.set(x, 6, -1.6);
    scene.add(rod);
    const p = new THREE.PointLight(0xfff4e0, 14, 11, 2);
    p.position.set(x, 5.2, -1.2);
    scene.add(p);
    DIMMABLE.push(p);
    // **光暈不上後製。** UnrealBloomPass 要多帶四五個檔案，而這裡只有三盞燈
    // 跟一塊招牌需要發光——用一張加法混色的徑向漸層貼片就夠，成本幾乎是零。
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: GLOW, color: 0xffeccc, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(3.4, 3.4, 1);
    halo.position.set(x, 5.3, -1.5);
    scene.add(halo);
  }

  // 後牆上的招牌：畫在 canvas 上，加一層 emissive 當霓虹
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 256;
  const x2 = c.getContext("2d");
  x2.fillStyle = "#453a5e"; x2.fillRect(0, 0, 1024, 256);
  x2.strokeStyle = "#8de8e0"; x2.lineWidth = 8; x2.strokeRect(14, 14, 996, 228);
  x2.strokeStyle = "#f2c46b"; x2.lineWidth = 4; x2.strokeRect(30, 30, 964, 196);
  x2.textAlign = "center"; x2.textBaseline = "middle";
  x2.fillStyle = "#f6f4fb";
  x2.font = "700 108px 'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif";
  x2.fillText("格莉奇遊樂園", 512, 108);
  x2.fillStyle = "#8de8e0";
  x2.font = "400 40px system-ui,sans-serif";
  x2.fillText("G L I T C H   P A R K", 512, 190);
  const signTex = new THREE.CanvasTexture(c);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.6),
    new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex,
      emissiveIntensity: 0.55, roughness: 0.8 }));
  sign.position.set(0, 4.5, -6.92);
  scene.add(sign);

  // ── 背牆的裝飾 ────────────────────────────────────────────────────────
  // **一整片素色的牆會讓這裡看起來像還沒蓋完。** 牆上掛兩張海報加一條像素帶：
  // 海報直接用角色立繪（素材已經在了，不必另外畫），像素帶呼應她衣服上的
  // 像素花紋，也順便把冷色的大片牆切開。
  function poster(x, charId, bg, caption) {
    const g = new THREE.Group();
    g.position.set(x, 3.3, -6.88);
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 3.2),
      new THREE.MeshStandardMaterial({ color: 0xf6f4fb, roughness: 0.9 }));
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(2.26, 2.72),
      new THREE.MeshStandardMaterial({ color: bg, roughness: 0.9 }));
    inner.position.set(0, 0.2, 0.01);
    g.add(frame, inner);
    // 標題畫在 canvas 上
    const c = document.createElement("canvas");
    c.width = 512; c.height = 96;
    const x2 = c.getContext("2d");
    x2.clearRect(0, 0, 512, 96);
    x2.fillStyle = "#453a5e";
    x2.font = "600 46px 'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif";
    x2.textAlign = "center"; x2.textBaseline = "middle";
    x2.fillText(caption, 256, 50);
    const tt = new THREE.CanvasTexture(c);
    tt.colorSpace = THREE.SRGBColorSpace;
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.41),
      new THREE.MeshStandardMaterial({ map: tt, transparent: true, roughness: 0.9 }));
    cap.position.set(0, -1.32, 0.02);
    g.add(cap);
    loader.load(`./assets/chars/${charId}.webp`, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const h = 2.4, w = h * (tex.image.width / tex.image.height);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, roughness: 0.9 }));
      m.position.set(0, 0.26, 0.03);
      g.add(m);
    });
    scene.add(g);
  }
  poster(-4.9, "glitch", PAL.mint, "本月新商品");
  poster(4.9, "blackhole", PAL.amber, "全七種");

  // 像素帶：牆面中段一條，把大片素色切開
  (function pixelBand() {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 16;
    const x2 = c.getContext("2d");
    x2.fillStyle = "#e3dff4"; x2.fillRect(0, 0, 64, 16);
    const cols = ["#9b7fd4", "#8de8e0", "#f2c46b", "#d9b8f0", "#f3a97e"];
    for (let i = 0; i < 16; i++) {
      x2.fillStyle = cols[(i * 3) % cols.length];
      x2.fillRect(i * 4, (i % 3) * 4 + 2, 4, 4);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping; t.repeat.set(7, 1);
    t.magFilter = THREE.NearestFilter;      // 像素就是要硬邊，不要糊掉
    t.colorSpace = THREE.SRGBColorSpace;
    const band = new THREE.Mesh(new THREE.PlaneGeometry(26, 0.46),
      new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
    band.position.set(0, 2.62, -6.9);   // 要在機台上緣之上，不然整條被擋住
    scene.add(band);
  })();

  // 兩側成排的扭蛋機
  // 冷暖交錯排。背景機台與獎品蛋共用這一排，暖色大約佔三分之一。
  const tints = [PAL.violet, PAL.amber, PAL.mint, PAL.pink, PAL.apricot, PAL.hair];
  let i = 0;
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const g = machine.clone(true);
      g.traverse(o => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        if (o.name === "body") o.material.color.setHex(tints[i % tints.length]);
        if (o.name === "metal") o.material.color.setHex(PAL.skirt);
        // **背景機台不可以掛同一塊招牌。** 六台一模一樣的「格莉奇遊樂園」
        // 排在後面，看起來不是一間店，是同一張圖貼了六次。
        if (o.name === "sign") o.visible = false;
        // **背景的罩子不要用 transmission。** 那是會真的折射的玻璃材質，
        // three.js 每一幀要為它多算一次不透明場景的貼圖——六台背景機台各配
        // 一顆等於同一個成本乘六倍。桌機軟體渲染量到只有 2 FPS 就是這裡在吃。
        // 背景本來就會被霧蓋掉、離主角又遠，換回便宜的半透明就夠了。
        if (o.name === "dome") {
          // **本人回報兩次「還是看起來像完全透明」——上一輪加到 0.42 不夠。**
          // 這次直接推到看得出「這是一顆實體的玻璃罩」的程度：顏色更飽和的
          // 淺藍、不透明度拉到 0.6，環境反射再加強，寧可比真玻璃稍微明顯，
          // 也不要回到「幾乎看不見」。
          o.material = new THREE.MeshStandardMaterial({
            color: 0x8fc4ea, roughness: 0.1, metalness: 0, transparent: true,
            opacity: 0.6, side: THREE.DoubleSide, envMapIntensity: 1.6 });
        }
        o.castShadow = false;                 // 背景不投影，省算也省雜訊
      });
      g.position.set(sx * (2.9 + k * 1.9), 0, -3.2 - k * 1.3);
      g.rotation.y = -sx * 0.34;
      g.scale.setScalar(0.92);
      contact(g, 3.0, 3.0, 0.4);
      scene.add(g);
      i++;
    }
  }

  // 後牆邊的獎品架，上面擺幾顆大蛋
  const shelfMat = M(0xe3dff4, 0.85);
  for (let r = 0; r < 2; r++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(7, 0.1, 0.5), shelfMat);
    b.position.set(0, 1.1 + r * 0.95, -6.6);
    b.castShadow = b.receiveShadow = true;
    scene.add(b);
    for (let n = 0; n < 9; n++) {
      const ballG = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12),
        M(tints[(n + r) % tints.length], 0.35, 0.05));
      ballG.position.set(-3.1 + n * 0.78, 1.34 + r * 0.95, -6.55);
      scene.add(ballG);
    }
  }
})();

// ── 掉出來的那顆蛋 ──────────────────────────────────────────────────────
const ballTop = new THREE.Mesh(new THREE.SphereGeometry(0.2, 26, 18, 0, Math.PI * 2, 0, Math.PI / 2), capMat(0xffffff));
const ballBot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 26, 18, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), capMat(0xffffff));
const ball = new THREE.Group();
ball.add(ballTop, ballBot);
ballTop.castShadow = ballBot.castShadow = true;
ball.visible = false;
scene.add(ball);

// ── 紙板立牌 ────────────────────────────────────────────────────────────
// 獎品專屬的那一盞。全場暗下來的時候只有它留著，像展示櫃裡打的燈。
const prizeLight = new THREE.SpotLight(0xffffff, 0, 9, 0.5, 0.45, 1.4);
prizeLight.position.set(0.9, 4.2, 5.2);
scene.add(prizeLight, prizeLight.target);

const standee = new THREE.Group();
standee.visible = false;
scene.add(standee);
// buildStandee 每次呼叫都整組重建，不需要留模組層級的變數。

function buildStandee(char, done) {
  loader.load(`./assets/chars/${char.id}.webp`, tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    const h = 1.8, w = h * (tex.image.width / tex.image.height);
    standee.clear();

    // **本人拍板：只要一片貼圖，不要疊層做厚度。** 疊 rim／front／edge／back
    // 四片假紙板厚度看起來反而像貼歪的四張紙；改回一片乾淨的立繪面板。
    const D = 0.02;   // 只留一點點，讓面板不會跟轉盤同一個深度
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, roughness: 0.9 }));
    front.position.set(0, h / 2, -D);
    front.castShadow = true;

    // 轉盤與台座。台座讓立牌離地，展示的時候整個人才進得了畫面。
    // **不要另外加一塊「往前折的紙板」底座。** 那塊小方塊在亮場景下
    // 幾乎看不出立體，只讀成立牌腳邊一個莫名的白色方框（本人回報）。
    const turn = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.66, w * 0.7, 0.06, 36),
      new THREE.MeshStandardMaterial({ color: PAL.mint, roughness: 0.3, metalness: 0.25,
        roughnessMap: ROUGH, envMapIntensity: 1.1 }));
    turn.position.set(0, -0.03, -D / 2);
    turn.receiveShadow = turn.castShadow = true;
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.56, 0.5, 28),
      new THREE.MeshStandardMaterial({ color: PAL.hoodie, roughness: 0.5, metalness: 0.1,
        roughnessMap: ROUGH }));
    stand.position.set(0, -0.31, -D / 2);
    stand.castShadow = true;

    standee.add(front, turn, stand);
    done && done();
  });
}

// ── 獲得演出 ────────────────────────────────────────────────────────────
// **轉到東西的那一刻是這款唯一的高潮，不可以只有淡入。** 四層疊起來：
//   放射光　　在立牌後面慢慢轉，把視線鎖在中間
//   擴散光環　一圈亮環往外推然後消失，那是「噹」的視覺對應
//   愛心與星　繞著立牌往上飄，可愛的那一份靠它
//   全螢幕閃　畫面整個亮一下（CSS，見 index.html 的 #flash）
// 全部都是加法混色的貼片，沒有後製、沒有粒子引擎，手機也跑得動。

function rayTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const x = c.getContext("2d");
  x.translate(256, 256);
  for (let i = 0; i < 24; i++) {
    x.rotate(Math.PI * 2 / 24);
    const g = x.createLinearGradient(0, 0, 0, -256);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.35, "rgba(255,255,255,.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.beginPath(); x.moveTo(0, 0);
    x.lineTo(-13, -256); x.lineTo(13, -256); x.closePath(); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shapeTexture(kind) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  x.fillStyle = "#fff";
  if (kind === "heart") {
    x.beginPath();
    x.moveTo(32, 56);
    x.bezierCurveTo(4, 36, 8, 12, 24, 12);
    x.bezierCurveTo(30, 12, 32, 17, 32, 20);
    x.bezierCurveTo(32, 17, 34, 12, 40, 12);
    x.bezierCurveTo(56, 12, 60, 36, 32, 56);
    x.fill();
  } else {                                   // 四角星
    x.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, r = i % 2 ? 9 : 30;
      x[i ? "lineTo" : "moveTo"](32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    x.closePath(); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const FX = new THREE.Group();
FX.visible = false;
scene.add(FX);

const rays = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6),
  new THREE.MeshBasicMaterial({ map: rayTexture(), transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, color: 0xfff3d0 }));
rays.position.set(0, 1.0, -0.4);   // 往後退，確保畫在立牌之後
FX.add(rays);

const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: GLOW, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, color: 0xaaf6ee }));
halo.position.set(0, 1.0, -0.55);  // 比光芒更後面，當最底層的暈
FX.add(halo);

// 愛心與星星：繞著立牌往上飄
const HEART = shapeTexture("heart"), STAR = shapeTexture("star");
const motes = [];
for (let i = 0; i < 26; i++) {
  const heart = i % 3 === 0;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: heart ? HEART : STAR,
    color: heart ? 0xff9ec4 : 0xffc233,   // 愛心粉紅、星星黃（本人拍板）
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const size = heart ? 0.22 : 0.16;
  sp.scale.set(size, size, 1);
  FX.add(sp);
  motes.push({ sp, a: Math.random() * Math.PI * 2, r: 0.7 + Math.random() * 0.9,
               y0: Math.random() * 0.6, speed: 0.5 + Math.random() * 0.7,
               spin: (Math.random() - 0.5) * 2, size });
}

function fxStart() {
  FX.position.copy(standee.position);
  FX.visible = true;
  rays.rotation.z = 0;
  document.getElementById("flash").classList.remove("on");
  void document.getElementById("flash").offsetWidth;   // 重新觸發動畫
  document.getElementById("flash").classList.add("on");
}

function fxUpdate(dt, age) {
  if (!FX.visible) return;
  rays.rotation.z += dt * 0.32;
  rays.material.opacity = 0.2 + Math.max(0, 0.45 - age * 0.18);
  // 光環：前 0.7 秒往外推一圈
  const hx = Math.min(age / 0.7, 1);
  halo.scale.setScalar(0.6 + hx * 5.2);
  halo.material.opacity = (1 - hx) * 0.85;
  for (const m of motes) {
    const life = (age * m.speed + m.y0) % 2.4;
    const k = life / 2.4;
    // z 保持在她前緣以內（<=0），飄在她周圍而不是正對著臉那一片。
    m.sp.position.set(Math.cos(m.a + age * m.spin * 0.6) * m.r,
                      0.1 + life * 0.95,
                      Math.sin(m.a + age * m.spin * 0.6) * m.r * 0.3 - 0.05);
    // **加法混色在透明度接近 1 時會把顏色推向白色**（三個色頻同時疊加到滿）——
    // 之前星星在最亮那一幀看起來是白的不是黃的，就是被這個效果洗掉的。
    // 峰值壓到 0.7，色相在最亮的瞬間也留得住，看起來才是黃色的星星而不是白閃光。
    m.sp.material.opacity = Math.sin(k * Math.PI) * 0.7;
    const pulse = 1 + Math.sin(age * 5 + m.a) * 0.15;
    m.sp.scale.set(m.size * pulse, m.size * pulse, 1);
  }
}

// ── 狀態機 ──────────────────────────────────────────────────────────────
// 每一段都是「從 t=0 跑到 t=1」，中間的位置用曲線算。沒有物理引擎。
const S = { IDLE: 0, COINED: 1, CRANK: 2, DROP: 3, WAIT: 4, OPEN: 5, SHOW: 6 };
let state = S.IDLE, t = 0, picked = null, isNew = false;
// 壓黑的程度：0 是平常，1 是全場只剩獎品那一盞
let dim = 0, dimTarget = 0;
const BASE_LIGHT = new WeakMap();

// ── 音效 ────────────────────────────────────────────────────────────────
// **用 Web Audio API 現場合成，不掛外部音檔。** 投幣、轉把手、開獎三種都是
// 短促的提示音，合成比找一份授權乾淨的音效快，檔案也是零位元組——這款
// 之後要嵌進 Larch 的小遊戲卡，卡片本身已經在載入平台的東西，能不多帶
// 檔案就不多帶。
let actx = null;
let muted = false;
try { muted = localStorage.getItem("glitch-park-gacha:muted") === "1"; } catch (e) { /* 環境不給存就當沒開過 */ }

function audio() {
  // **瀏覽器的自動播放政策要求 AudioContext 要在使用者手勢裡才能真的發聲。**
  // 第一次投幣的點擊本身就是手勢，這裡順著它才建立，不要在頁面一載入就開。
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === "suspended") actx.resume();
  return actx;
}

function tone(ctx, t0, freq, dur, type, gain) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

/** 一聲短促的白噪音喀嚓，濾成偏高頻，當機械聲用。 */
function click(ctx, t0, dur, gain) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const n = ctx.createBufferSource(); n.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  n.connect(f).connect(g).connect(ctx.destination);
  n.start(t0);
}

function sfxCoin() {
  if (muted) return;
  const ctx = audio(), t0 = ctx.currentTime;
  tone(ctx, t0, 1500, 0.09, "sine", 0.16);
  tone(ctx, t0 + 0.05, 2200, 0.12, "sine", 0.14);
}

function sfxCrank() {
  if (muted) return;
  const ctx = audio(), t0 = ctx.currentTime;
  // 六聲喀嚓，模擬齒輪一格一格轉過去
  for (let i = 0; i < 6; i++) click(ctx, t0 + i * 0.09, 0.025, 0.1);
}

function sfxWin() {
  if (muted) return;
  const ctx = audio(), t0 = ctx.currentTime;
  [523.25, 659.25, 784.0, 1046.5].forEach((f, i) =>   // C5 E5 G5 C6，小小的凱旋音
    tone(ctx, t0 + i * 0.09, f, 0.35, "triangle", 0.15));
}

/** 開獎那一刻播那個角色講的那句話。用 CosyVoice3 走 glitch-vn 同一條配音管線
 *  現生的，跟本篇同一支參考音、同一個語氣指示，聲線是同一個人。 */
function playVoice(char) {
  if (muted) return;
  const a = new Audio(`./assets/voice/${char.id}.mp3`);
  a.volume = 0.9;
  a.play().catch(() => {});   // 有些瀏覽器連使用者手勢裡都會偶爾拒放，別讓它炸整支
}

function toggleMute() {
  muted = !muted;
  try { localStorage.setItem("glitch-park-gacha:muted", muted ? "1" : "0"); } catch (e) { /* 存不了就算了 */ }
  paintMute();
}
function paintMute() {
  muteBtn.textContent = muted ? "音效：關" : "音效：開";
  muteBtn.setAttribute("aria-pressed", String(muted));
}

function enterShow() {
  state = S.SHOW; t = 0;
  ball.visible = false;
  // **機台本身要藏起來。** 立牌走到鏡頭前展示時，機台還站在原地，
  // 壓黑時只有 prizeLight 沒被壓暗，那盞燈打在機台的白色機身上，
  // 從她背後透出一塊發亮的方形——本人回報「腳邊那個方形框框」，
  // 追出來是這個，不是立牌自己的問題（拆過材質、拆過每一片貼圖都排除了）。
  // 展示這一刻本來就不需要看到機台，藏起來比縮小光錐更乾淨。
  machine.visible = false;
  sfxWin();
  playVoice(picked);
  ballTop.position.y = ballBot.position.y = 0; ballTop.rotation.x = 0;
  // **立牌要走到鏡頭前面來。** 留在機台旁邊的話，它旁邊是一台兩公尺高的
  // 機器，再大的公仔都會看起來很小——本人回報的就是這個。
  // 這一刻不是寫實比例，是展示：轉出來的東西站到你面前，機台退到後面去。
  // **位置是算出來的，不是試出來的。** 鏡頭在 (0,2.5,7.4) 看向 (0,1.55,-0.6)，
  // FOV 40°：在 z=2.8 那個深度，畫面裝得下的是 y≈0.28 到 3.62。
  // 立牌腳放在 y=0 的話，腳會落在畫面下緣之外（本人看到的就是腳被切掉）。
  // 所以架一座台子把它抬到 0.5，整個人就都在框裡，而且佔畫面一半高。
  standee.position.set(0, 0.5, 2.8);
  prizeLight.target.position.set(0, 1.2, 2.8);
  standee.visible = true;
  showCard();
  fxStart();
  dimTarget = 1;
  go.disabled = false;
  go.textContent = "再轉一次";
}

const ease = {
  out: x => 1 - Math.pow(1 - x, 3),
  inOut: x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
  back: x => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2),
};

function setHint(s) { hint.innerHTML = s; }

function coin() {
  if (state !== S.IDLE) return;
  state = S.COINED; t = 0;
  go.disabled = true;
  setHint("投進去了。<b>轉那個把手</b>。");
  sfxCoin();
  coinFly();
}

function turn() {
  if (state !== S.COINED) return;
  state = S.CRANK; t = 0;
  picked = roll();
  ballTop.material.color.setHex(picked.tint);
  ballBot.material.color.setHex(0xf3ede4);
  setHint("……");
  sfxCrank();
}

// 蛋的路徑：罩子底 → 機台裡 → 取物口。三個控制點的貝茲曲線。
const P0 = new THREE.Vector3(0, 1.32, 0);
const P1 = new THREE.Vector3(0.18, 0.78, 0.28);
const P2 = new THREE.Vector3(0, 0.44, 0.52);
function ballAt(x) {
  const a = P0.clone().lerp(P1, x), b = P1.clone().lerp(P2, x);
  return a.lerp(b, x);
}

function open() {
  if (state !== S.WAIT) return;
  state = S.OPEN; t = 0;
  isNew = Store.own(picked.id);
  paintShelf();
  buildStandee(picked);      // 這一顆是誰，立牌才換成誰
  setHint("");
}

function showCard() {
  reveal.innerHTML =
    `<div class="box"><div class="tag${isNew ? " new" : ""}">${isNew ? "第一次轉到" : "重複了"}</div>` +
    `<div class="who">${picked.name}</div>` +
    `<div class="line">「${picked.line}」</div></div>`;
  reveal.classList.add("on");
}

function reset() {
  reveal.classList.remove("on");
  reveal.innerHTML = "";
  standee.visible = false;
  FX.visible = false;
  machine.visible = true;
  dimTarget = 0;
  ball.visible = false;
  crank.rotation.z = 0;
  state = S.IDLE; t = 0;
  go.disabled = false;
  go.textContent = "投幣";   // enterShow() 改成「再轉一次」，回到 IDLE 要換回來
  setHint(Store.data.owned.length === CHARS.length
    ? "<b>七種都轉到了。</b>再投一枚也可以。"
    : "投一枚代幣，然後轉把手。");
}

// ── 點擊 ────────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
/** 目前這個狀態下，滑鼠／手指指到什麼才算點得到。跟 pick() 共用同一份判斷，
 *  這樣游標會不會變手指、跟點下去有沒有反應，兩邊永遠一致，不會各自漂掉。 */
function hit() {
  if (state === S.COINED) return ray.intersectObjects(crank.children, true).length > 0;
  if (state === S.IDLE) return ray.intersectObjects([slot, bezel]).length > 0;
  if (state === S.WAIT) return ray.intersectObject(ball, true).length > 0;
  if (state === S.SHOW) return t > 0.55;
  return false;
}

function setPointer(ev) {
  const e = ev.changedTouches ? ev.changedTouches[0] : ev;
  ptr.x = (e.clientX / innerWidth) * 2 - 1;
  ptr.y = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(ptr, camera);
}

function pick(ev) {
  setPointer(ev);
  if (state === S.COINED && hit()) return turn();
  if (state === S.IDLE && hit()) return coin();
  if (state === S.WAIT && hit()) return open();
  if (state === S.SHOW && hit()) return reset();
}
renderer.domElement.addEventListener("pointerdown", pick);
go.addEventListener("click", () => (state === S.SHOW ? reset() : coin()));

// **投幣孔、把手、蛋這幾個可以點的東西，滑鼠移過去要變成手指游標。**
// 沒有這個的話，玩家不知道畫面上哪裡點得下去——本人回報「滑鼠操作應該是
// 手指頭」。手機是觸控，不會有 hover，這段對手機無害也用不到。
renderer.domElement.addEventListener("pointermove", ev => {
  setPointer(ev);
  renderer.domElement.style.cursor = hit() ? "pointer" : "default";
});

// ── 收集架 ──────────────────────────────────────────────────────────────
function paintShelf() {
  shelf.innerHTML = "";
  for (const c of CHARS) {
    const d = document.createElement("div");
    const has = Store.data.owned.includes(c.id);
    d.className = "slot" + (has ? " has" : "");
    d.title = has ? c.name : "還沒轉到";
    // **轉到的人用大頭貼，不是首字。** art/avatar 那批本來就是給這裡用的頭像，
    // 一個字（「格」「黑」……）認不出是誰，頭像才認得出。沒轉到的維持問號，
    // 不要先把長相洩漏出去。
    if (has) {
      const img = document.createElement("img");
      img.src = `./assets/avatar/${c.id}.webp`;
      img.alt = c.name;
      d.appendChild(img);
    } else {
      d.textContent = "？";
    }
    if (has && picked && c.id === picked.id) {
      d.classList.add("pop");
      setTimeout(() => d.classList.remove("pop"), 320);
    }
    shelf.appendChild(d);
  }
}

// ── 收集清單面板 ────────────────────────────────────────────────────────
// **點右上角那排頭像，列出已經轉到的人。** 只列轉到的，沒轉到的不出現——
// 本人拍板：不要用清單再洩漏一次「還有誰沒轉到」，那件事交給問號圖示就夠。
function openCollection() {
  const owned = CHARS.filter(c => Store.data.owned.includes(c.id));
  collectionList.innerHTML = owned.length
    ? owned.map(c => `<div class="row">
        <img src="./assets/avatar/${c.id}.webp" alt="">
        <div><div class="name">${c.name}</div><div class="line">「${c.line}」</div></div>
      </div>`).join("")
    : `<div class="empty">還沒轉到任何人，先去投幣看看。</div>`;
  collection.querySelector(".head span").textContent =
    `收集進度　${owned.length} / ${CHARS.length}`;
  collection.hidden = false;
  collectionClose.focus();
}
function closeCollection() { collection.hidden = true; shelf.focus(); }

shelf.addEventListener("click", openCollection);
shelf.addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCollection(); }
});
collectionClose.addEventListener("click", closeCollection);
collection.addEventListener("click", e => { if (e.target === collection) closeCollection(); });
addEventListener("keydown", e => { if (e.key === "Escape" && !collection.hidden) closeCollection(); });
muteBtn.addEventListener("click", toggleMute);

// ── 主迴圈 ──────────────────────────────────────────────────────────────
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  t += dt;

  // 鏡頭微動：指標偏移用低通濾一下，再疊一個很慢的呼吸
  look.x += (look.tx - look.x) * Math.min(dt * 2.6, 1);
  look.y += (look.ty - look.y) * Math.min(dt * 2.6, 1);
  const breathe = Math.sin(now / 5200) * 0.045;
  camera.position.set(camBase.x + look.x * 0.42, camBase.y - look.y * 0.22 + breathe, camBase.z);
  camera.lookAt(camAim.x + look.x * 0.12, camAim.y - look.y * 0.06, camAim.z);

  // 壓黑：把每一盞燈按比例降下來，同時把背景與霧一起壓暗，
  // 不然燈暗了牆還是亮的，看起來像沒接好。
  dim += (dimTarget - dim) * Math.min(dt * 3.4, 1);
  if (dim > 0.001 || dimTarget > 0) {
    // **要真的壓到接近黑，不是壓成深紫。** 第一版留了 18% 的燈光地板跟只壓
    // 88% 到 0x191428（那其實是深紫，不是黑），本人的原話是「應該整畫面壓黑」——
    // 量出來的截圖只是「暗一點的紫」，沒有黑到讓獎品跳出來。
    // 這裡把地板壓到 4%（不是 0，全暗會讓場外輪廓完全消失、看起來像關機），
    // 目標色換成真的接近黑（帶一點點冷色相，不是純 #000，純黑在螢幕上會死黑一片）。
    const k = 1 - dim * 0.96;
    for (const L of DIMMABLE) {
      if (!BASE_LIGHT.has(L)) BASE_LIGHT.set(L, L.intensity);
      L.intensity = BASE_LIGHT.get(L) * k;
    }
    prizeLight.intensity = dim * 40;
    const bg = new THREE.Color(PAL.sky).lerp(new THREE.Color(0x07060c), dim);
    scene.background = bg;
    scene.fog.color = bg;
  }

  // 投幣動畫：跟遊戲狀態機分開跑，不受 state 影響（COINED 已經進去了，
  // 這段純粹是視覺效果）。飛到一半開始縮小＋立起來，像側身滑進投幣孔。
  if (coinT !== null) {
    coinT = Math.min(coinT + dt / 0.42, 1);
    const x = ease.out(coinT);
    coinMesh.position.lerpVectors(COIN_FROM, COIN_TO, x);
    coinMesh.rotation.z = x * Math.PI * 3;                    // 飛行途中翻滾
    coinMesh.rotation.y = Math.max(0, (x - 0.6) / 0.4) * (Math.PI / 2);  // 最後轉正側身滑入
    coinMesh.scale.setScalar(1 - Math.max(0, x - 0.75) / 0.25 * 0.8);
    if (coinT === 1) { coinMesh.visible = false; coinT = null; }
  }

  heap.rotation.y += dt * 0.06;

  if (state === S.COINED) {
    // 把手晃一下，告訴玩家該轉哪裡
    crank.rotation.z = Math.sin(t * 5) * 0.06;
  } else if (state === S.CRANK) {
    const x = Math.min(t / 0.9, 1);
    crank.rotation.z = ease.inOut(x) * Math.PI * 2;
    if (x === 1) { state = S.DROP; t = 0; ball.visible = true; }
  } else if (state === S.DROP) {
    const x = Math.min(t / 1.1, 1);
    ball.position.copy(ballAt(ease.out(x)));
    ball.rotation.x = x * 7; ball.rotation.z = x * 4;
    if (x === 1) {
      state = S.WAIT; t = 0;
      setHint("<b>點那顆蛋</b>打開它。");
    }
  } else if (state === S.WAIT) {
    ball.position.y = 0.44 + Math.sin(t * 2.6) * 0.012;
  } else if (state === S.OPEN) {
    const x = Math.min(t / 0.55, 1);
    ballTop.position.y = ease.out(x) * 0.42;
    ballBot.position.y = -ease.out(x) * 0.1;
    ballTop.rotation.x = x * 1.4;
    ball.position.z = 0.52 + x * 0.55;
    if (x === 1) enterShow();
  } else if (state === S.SHOW) {
    fxUpdate(dt, t);
    const x = Math.min(t / 0.7, 1);
    standee.scale.setScalar(0.45 + ease.back(x) * 0.55);
    // **轉完就停，不要一直搖。** 原本 x=1 之後還疊了一個正弦波讓它持續小幅
    // 擺動，本人要的是「立好之後不動」。現在只剩落地前這段旋轉動畫，
    // x=1 之後 rotation.y 就固定在 0，正對鏡頭——單片立牌本來就該正面看。
    standee.rotation.y = (1 - x) * 1.1;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ── 起動 ────────────────────────────────────────────────────────────────
(async function start() {
  await Store.load();
  resize();
  paintShelf();
  paintMute();   // 反映上次關掉音效的選擇（存在 localStorage，跟遊戲進度分開存）
  // 七張圖先載起來，轉到的時候才不會空一拍
  let left = CHARS.length;
  for (const c of CHARS) {
    loader.load(`./assets/chars/${c.id}.webp`, () => { if (--left === 0) ready(); },
      undefined, () => { if (--left === 0) ready(); });
  }
  function ready() {
    go.disabled = false;
    setHint(Store.data.owned.length === CHARS.length
      ? "<b>七種都轉到了。</b>再投一枚也可以。"
      : "投一枚代幣，然後轉把手。");
  }
  go.disabled = true;
  setHint("載入中……");
  requestAnimationFrame(frame);
  // 轉到的時候才建立立牌；先建一個免得第一次卡頓
  buildStandee(CHARS[0]);
})();

// ── 測試用鉤子 ──────────────────────────────────────────────────────────
// **只在 ?test=1 開，正式頁面不掛。** 讓自動化測試用真的相機投影算出
// 把手／蛋在畫面上的座標，不必為每種視窗尺寸各猜一組像素座標
// （2026-09-15 用猜的百分比點位在窄視窗撲空過，等了 90 秒才逾時）。
if (new URLSearchParams(location.search).get("test") === "1") {
  window.__test = {
    screenOf(obj) {
      const v = new THREE.Vector3();
      obj.getWorldPosition(v);
      v.project(camera);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (1 - (v.y * 0.5 + 0.5)) * innerHeight };
    },
  };
  window.__test.crank = () => window.__test.screenOf(knob);
  window.__test.ball = () => window.__test.screenOf(ball);
  window.__test.coin = () => window.__test.screenOf(coinMesh);
  window.__test.coinFly = () => coinFly();
  // **直接把 dim 撥到 1。** swiftshader 軟體渲染太慢，dt 又夾在每幀最多
  // 0.05 秒模擬時間，真實等了快兩秒，模擬時間其實只過了零點幾秒，壓黑
  // 根本還沒跑完——這支拿來確認「dim 真的到 1 之後背景是不是夠黑」，
  // 不用等軟渲染追上真實時間。
  window.__test.forceDim = () => { dim = dimTarget = 1; };
  // 揭曉時把立牌轉到定格的角度截圖看仔細用，跳過那段旋轉動畫。
  window.__test.freezeStandee = () => {
    standee.rotation.set(0, 0, 0);
    standee.scale.setScalar(1);
    state = S.SHOW; t = 999;
  };
  // **直接跳到揭曉畫面，略過投幣／轉把手／蛋掉落的動畫。** 那三段動畫
  // 在真實裝置上很快，可是在測試用的軟體渲染下會被拖成慢動作（見上面
  // forceDim 的註解），一輪要等好幾分鐘。要驗的是揭曉那一刻的畫面，
  // 不是動畫本身，跳過去才能一次迭代一次驗證。
  window.__test.jumpToReveal = (id) => {
    picked = id ? CHARS.find(c => c.id === id) || roll() : roll();
    isNew = Store.own(picked.id);
    paintShelf();
    buildStandee(picked);
    enterShow();
  };
}
