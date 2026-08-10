# LocalMiniDrama 鍏ㄩ潰 Bug 瀹¤鎶ュ憡

> **瀹¤鏃ユ湡**锛?026-08-04
> **瀹¤鑼冨洿**锛氬叏鏍堬紙鍓嶇 Vue 3 + 鍚庣 Node.js/Express + SQLite锛?
> **瀹¤鍩哄噯**锛歚HEAD~5` 鑷?`HEAD`锛堟牱寮忕粺涓€閲嶆瀯鍚庯級
> **瑕嗙洊鏂囦欢**锛氬墠绔?10 涓鍥俱€?8 涓粍浠躲€?0 涓?API 妯″潡銆佸悗绔?30+ 璺敱銆?0+ 鏈嶅姟
> **鏂囨。鐗堟湰**锛歷1.0

---

## 鐩綍

1. [涓ラ噸 Bug锛堭煍?3 涓級](#涓€涓ラ噸-bug-3-涓?
2. [楂樹紭鍏堢骇 Bug锛堭煙?5 涓級](#浜岄珮浼樺厛绾?bug-5-涓?
3. [涓紭鍏堢骇 Bug锛堭煙?8 涓級](#涓変腑浼樺厛绾?bug-8-涓?
4. [浣庝紭鍏堢骇 / 浠ｇ爜璐ㄩ噺锛堭煙?3 涓級](#鍥涗綆浼樺厛绾?-浠ｇ爜璐ㄩ噺-3-涓?
5. [淇浼樺厛绾ф眹鎬籡(#浜斾慨澶嶄紭鍏堢骇姹囨€?
6. [淇璺嚎鍥綸(#鍏慨澶嶈矾绾垮浘)

---

## 涓€銆佷弗閲?Bug锛堭煍?3 涓級

> 鐩存帴褰卞搷鏍稿績鍔熻兘锛岀敤鎴峰彲瑙侊紝蹇呴』浼樺厛淇銆?

---

### Bug 1锛氬悗绔獙璇佸己鍒跺熬甯у繀濉紝浣?UI 鏍囨敞銆岄€夊～銆?

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃敶 涓ラ噸 |
| **鏂囦欢** | `backend-node/src/services/omniVideoService.js` |
| **琛屽彿** | 98 |

**褰撳墠浠ｇ爜**锛?
```javascript
if (first.length !== 1 || last.length !== 1 || first[0].type !== 'image' || last[0].type !== 'image')
  throw new Error('棣栧熬甯х敓瑙嗛蹇呴』涓斿彧鑳介€夋嫨涓€寮犲浘鐗囬甯у拰涓€寮犲浘鐗囧熬甯?);
```

**姝ｇ‘浠ｇ爜**锛?
```javascript
if (first.length !== 1 || last.length > 1 || first[0].type !== 'image' || (last.length === 1 && last[0].type !== 'image'))
  throw new Error('棣栧熬甯х敓瑙嗛蹇呴』涓斿彧鑳介€夋嫨涓€寮犲浘鐗囬甯э紝灏惧抚鍙€夛紙鏈€澶氫竴寮狅級');
```

**闂鍒嗘瀽**锛?

`last.length !== 1` 瑕佹眰蹇呴』鎭板ソ鏈?1 涓熬甯с€備絾锛?

- UI 涓娿€屽熬甯с€嶆爣娉ㄤ负 **閫夊～**锛坄<span class="frame-tag">閫夊～</span>`锛?
- 鍓嶇 `canCreate` 璁＄畻灞炴€ф纭厑璁?`lastFrameCount.value <= 1`锛? 鎴?1 閮藉彲浠ワ級
- 鐢ㄦ埛閫夋嫨銆岄灏惧抚鐢熻棰戙€嶆ā寮忎絾涓嶈灏惧抚 鈫?鍓嶇閫氳繃妫€鏌?鈫?鍚庣鎷掔粷

**鐢ㄦ埛鐪嬪埌鐨勯敊璇?*锛?
```
棣栧熬甯х敓瑙嗛蹇呴』涓斿彧鑳介€夋嫨涓€寮犲浘鐗囬甯у拰涓€寮犲浘鐗囧熬甯?
```

**鐢ㄦ埛鐨勫疄闄呭洶鎯?*锛歎I 鏄庢槑鍐欑潃銆岄€夊～銆嶏紝涓轰粈涔堟彁浜ゆ椂鎶ラ敊锛?

**褰卞搷閾捐矾**锛?
```
鐢ㄦ埛閫夋嫨銆岄灏惧抚鐢熻棰戙€嶁啋 涓嶈灏惧抚 鈫?鐐瑰嚮銆岀敓鎴愬綋鍓嶉暅澶淬€?
  鈫?鍓嶇 canCreate 妫€鏌ラ€氳繃锛坙astFrameCount <= 1锛?
  鈫?璋冪敤 omniVideoAPI.create()
  鈫?鍚庣 omniVideoService.create() 璋冪敤 validateCreationMode()
  鈫?鎶涘嚭 Error('棣栧熬甯х敓瑙嗛蹇呴』涓斿彧鑳介€夋嫨涓€寮犲浘鐗囬甯у拰涓€寮犲浘鐗囧熬甯?)
  鈫?鍓嶇 catch 鈫?ElMessage.error('棣栧熬甯х敓瑙嗛蹇呴』...')
  鈫?鐢ㄦ埛锛氾紵锛燂紵
```

**淇**锛? 琛屼唬鐮侊紝`last.length !== 1` 鈫?`last.length > 1`

---

### Bug 2锛氶」鐩ā寮忎笅鍒囨崲闀滃ご鍚庨甯?灏惧抚閫夋嫨瀹屽叏涓㈠け

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃敶 涓ラ噸 |
| **鏂囦欢** | `frontweb/src/views/FreeCreate.vue` |
| **琛屽彿** | 183锛坄projectShot`锛夈€?37锛坄loadShot`锛?|

**闂鍒嗘瀽**锛?

淇濆瓨璺緞锛堢 251-252 琛岋級姝ｇ‘鍐欏叆浜?`omni_first_frame_asset_id` 鍜?`omni_last_frame_asset_id`锛?

```javascript
// saveCurrentShot() 绗?251-252 琛?鈥?姝ｇ‘
omni_first_frame_asset_id: chosenAssets.value.find((asset) => asset.usage === 'first_frame')?.id || null,
omni_last_frame_asset_id: chosenAssets.value.find((asset) => asset.usage === 'last_frame')?.id || null,
```

浣嗗姞杞借矾寰勬湁涓ゅ缂哄け锛?

**缂哄け 1锛歚projectShot()` 绗?183 琛?* 鈥?浠庢湭鎶婅繖涓や釜瀛楁鏄犲皠鍒?`assets` 鏁扮粍锛?

```javascript
function projectShot(storyboard) {
  const ids = Array.isArray(storyboard.omni_asset_ids) ? storyboard.omni_asset_ids.map(Number).filter(Number.isFinite) : []
  const usage = storyboard.omni_asset_usage || {}
  return {
    ...storyboard,
    // 娉ㄦ剰锛氭病鏈夊鐞?omni_first_frame_asset_id 鍜?omni_last_frame_asset_id
    assets: ids.map((asset_id) => ({ asset_id, usage: usage[asset_id] || 'reference' })),
    // ...
  }
}
```

**缂哄け 2锛歚loadShot()` 绗?237 琛?* 鈥?浠庢湭璇诲彇杩欎袱涓瓧娈垫潵鎭㈠閫夋嫨鐘舵€侊細

```javascript
function loadShot(shot) {
  // ...
  const ids = (shot.assets || []).map((item) => Number(item.asset_id)).filter(...)
  selected.value = new Set(ids)
  selectedOrder.value = ids
  // 娉ㄦ剰锛氭病鏈夋牴鎹?shot.omni_first_frame_asset_id 鍜?shot.omni_last_frame_asset_id
  // 璁剧疆瀵瑰簲 asset 鐨?usage = 'first_frame' / 'last_frame'
  // ...
}
```

**褰卞搷閾捐矾**锛?
```
鐢ㄦ埛璁剧疆闀滃ご A 鐨勯甯т负绱犳潗 X銆佸熬甯т负绱犳潗 Y
  鈫?淇濆瓨鎴愬姛锛堝悗绔纭瓨鍌級
  鈫?鍒囨崲鍒伴暅澶?B
  鈫?鍒囨崲鍥為暅澶?A
  鈫?loadShot(A) 琚皟鐢?
  鈫?omni_first_frame_asset_id 鍜?omni_last_frame_asset_id 琚拷鐣?
  鈫?棣栧抚/灏惧抚閫夋嫨涓㈠け
  鈫?鐢ㄦ埛蹇呴』閲嶆柊璁剧疆
```

**淇鏂规**锛堢害 40 琛岋級锛?

1. `projectShot()` 涓ˉ鍏咃細
```javascript
const firstFrameId = storyboard.omni_first_frame_asset_id
const lastFrameId = storyboard.omni_last_frame_asset_id
const assets = ids.map((asset_id) => ({
  asset_id,
  usage: asset_id === firstFrameId ? 'first_frame'
    : asset_id === lastFrameId ? 'last_frame'
    : usage[asset_id] || 'reference'
}))
```

2. `loadShot()` 涓湪璁剧疆 `selected` 鍜?`selectedOrder` 鍚庯紝琛ュ厖锛?
```javascript
// 鎭㈠棣栧抚/灏惧抚 usage
const firstFrameId = shot.omni_first_frame_asset_id
const lastFrameId = shot.omni_last_frame_asset_id
for (const id of ids) {
  const asset = assets.value.find((a) => a.id === id)
  if (asset) {
    if (id === firstFrameId) asset.usage = 'first_frame'
    else if (id === lastFrameId) asset.usage = 'last_frame'
  }
}
```

---

### Bug 3锛氳鑹?鍦烘櫙/閬撳叿鍥句粠鏈悓姝ュ埌 `assets` 琛?

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃敶 涓ラ噸 |
| **鏂囦欢** | `backend-node/src/services/dramaService.js`锛堝叏鏂囨棤 `assets` 寮曠敤锛?|
| **鍏宠仈鏂囦欢** | `frontweb/src/views/DramaDetail.vue`銆乣frontweb/src/views/FreeCreate.vue` |

**闂鍒嗘瀽**锛?

瀹¤鏂囨。绗?6.1 鑺傚缓璁垱寤?`assetMappingService.js`锛屼絾灏氭湭瀹炵幇銆傚叿浣撹〃鐜帮細

**琛ㄧ幇 1锛歚DramaDetail.vue` 涓婁紶瑙掕壊鍥句笉鍒涘缓 assets 璁板綍**

```javascript
// DramaDetail.vue 绗?622 琛?
await api.update(form.id, { image_url: url, local_path: null })
// 鍙洿鏂颁簡 characters.image_url 鍜?characters.local_path
// 娌℃湁鍦?assets 琛ㄤ腑鍒涘缓璁板綍
```

**琛ㄧ幇 2锛歚ensureProjectResourceAssets()` 鏄竴娆℃€х殑杞鍚屾**

```javascript
// FreeCreate.vue 绗?210-235 琛?
async function ensureProjectResourceAssets(project, mediaItems) {
  // 鍙湪椤甸潰鍔犺浇鏃惰繍琛屼竴娆?
  // 濡傛灉鍦?DramaDetail 涓婁紶浜嗘柊鍥剧墖锛屼笉浼氳Е鍙戦噸鏂板悓姝?
  // catch (_) {} 闈欓粯鍚炴帀鎵€鏈夐敊璇?
}
```

**琛ㄧ幇 3锛氬悗绔病鏈夊悓姝ラ挬瀛?*

```bash
$ grep -n "assets\|assetService\|assetMapping" backend-node/src/services/dramaService.js
# 鏃犺緭鍑?鈥?dramaService 瀹屽叏涓嶆秹鍙?assets 琛?
```

**褰卞搷閾捐矾**锛?
```
鐢ㄦ埛鍦?DramaDetail 涓婁紶瑙掕壊澶村儚
  鈫?鍚庣鍙洿鏂?characters.image_url / characters.local_path
  鈫?涓嶅垱寤?assets 璁板綍
  鈫?鐢ㄦ埛鍦?FreeCreate 椤圭洰妯″紡涓墦寮€宸ヤ綔鍙?
  鈫?ensureProjectResourceAssets() 鍙湪鍔犺浇鏃跺悓姝ヤ竴娆?
  鈫?鏂颁笂浼犵殑瑙掕壊鍥句笉鍑虹幇鍦ㄧ礌鏉愭睜
  鈫?鐢ㄦ埛蹇呴』鍒锋柊椤甸潰
```

**淇鏂规**锛氭柊寤?`backend-node/src/services/assetMappingService.js`锛?

```javascript
class AssetMappingService {
  async ensureAsset(db, entityType, entityId, options) {
    // 1. 鏌ユ壘鏄惁宸叉湁 assets 璁板綍
    // 2. 鏈夊垯鏇存柊锛屾棤鍒欏垱寤?
    // 3. 杩斿洖 asset_id
  }

  getEntityAssets(db, dramaId) {
    // 杩斿洖鎵€鏈夎鑹?鍦烘櫙/閬撳叿瀵瑰簲鐨?assets 璁板綍
  }
}
```

鐒跺悗鍦?`dramaService.saveCharacters()`銆乣sceneService.update()`銆乣propService.update()` 绛夊疄浣撳彉鏇村璋冪敤銆?

---

## 浜屻€侀珮浼樺厛绾?Bug锛堭煙?5 涓級

> 涓ラ噸褰卞搷鐢ㄦ埛浣撻獙锛屼絾涓嶈嚦浜庡畬鍏ㄩ樆濉炲姛鑳姐€?

---

### Bug 4锛歚DramaDetail.vue` 涓婁紶鍥剧墖鍚庝繚瀛樹簡 `local_path: null`

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煚 楂?|
| **鏂囦欢** | `frontweb/src/views/DramaDetail.vue` |
| **琛屽彿** | 622銆?02銆?72銆?44锛堝叡 4 澶勶級 |

**闂鍒嗘瀽**锛?

涓婁紶鎴愬姛鍚庯紝`data?.local_path` 鏈夊疄闄呭€硷紙绗?621 琛屽凡璧嬪€?`form.local_path = data?.local_path`锛夛紝浣嗕繚瀛樺埌鍚庣鏃跺嵈浼犱簡 `local_path: null`锛岃鐩栦簡瀹為檯璺緞銆?

**4 澶勭浉鍚?Bug**锛?

```javascript
// 绗?622 琛?鈥?doUploadLibImg 瑙掕壊/鍦烘櫙/閬撳叿搴?
await api.update(form.id, { image_url: url, local_path: null })
// 绗?702 琛?鈥?uploadDramaCharImg
await characterAPI.putImage(form.id, { image_url: url, local_path: null })
// 绗?772 琛?鈥?uploadDramaSceneImg
await sceneAPI.update(form.id, { image_url: url, local_path: null })
// 绗?844 琛?鈥?uploadDramaPropImg
await propAPI.update(form.id, { image_url: url, local_path: null })
```

**褰卞搷**锛?
```
涓婁紶杩斿洖 data = { url: '...', local_path: 'uploads/xxx.jpg', path: '...' }
  鈫?form.local_path = data?.local_path ?? null  // 姝ｇ‘璧嬪€?'uploads/xxx.jpg'
  鈫?淇濆瓨鏃朵紶 local_path: null
  鈫?鍚庣鏇存柊 characters.local_path = null
  鈫?鍚庣画閫氳繃 /static/uploads/xxx.jpg 璁块棶鍥剧墖鏃舵壘涓嶅埌鏂囦欢
  鈫?鍥剧墖鏄剧ず涓?broken
```

**淇**锛氭瘡澶勫皢 `local_path: null` 鏀逛负 `local_path: data?.local_path ?? null`

---

### Bug 5锛歚projectShot()` 灞曞紑鍘熷瀛楁瀵艰嚧闄堟棫鏁版嵁鍙闂?

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煚 楂?|
| **鏂囦欢** | `frontweb/src/views/FreeCreate.vue` |
| **琛屽彿** | 186-198 |

**闂鍒嗘瀽**锛?

```javascript
function projectShot(storyboard) {
  const ids = Array.isArray(storyboard.omni_asset_ids) ? storyboard.omni_asset_ids.map(Number).filter(Number.isFinite) : []
  const usage = storyboard.omni_asset_usage || {}
  return {
    ...storyboard,  // 鈫?鍖呭惈鍘熷 omni_asset_ids锛堟暟瀛楁暟缁勶級銆乷mni_asset_usage锛堝璞★級
    assets: ids.map((asset_id) => ({ asset_id, usage: usage[asset_id] || 'reference' })),  // 鈫?鎺ㄥ鐨勬暟缁?
    settings: { ... },
  }
}
```

灞曞紑 `...storyboard` 鎰忓懗鐫€鍘熷 `omni_asset_ids`锛堟暟瀛楁暟缁勶級鍜?`omni_asset_usage`锛堝璞★級浠嶇劧鍦ㄨ繑鍥炵殑瀵硅薄涓婏紝涓庢帹瀵煎嚭鐨?`assets` 鏁扮粍骞跺瓨銆傚鏋滃悗缁唬鐮佽鐢?`shot.omni_asset_ids` 鑰屼笉鏄?`shot.assets`锛屽緱鍒扮殑鏄湭澶勭悊鐨勫師濮嬫暟鎹€?

**瀹為檯椋庨櫓**锛歚loadShot()` 涓鍙?`shot.assets` 鏄纭殑锛屼絾濡傛灉鏈夋柊浠ｇ爜鎴栫涓夋柟鎺ュ叆鐩存帴璇?`shot.omni_asset_ids`锛屽氨浼氭嬁鍒板師濮嬫暟鎹€岄潪澶勭悊鍚庣殑 `{ asset_id, usage }` 鏍煎紡銆?

**淇**锛?
```javascript
function projectShot(storyboard) {
  const { omni_asset_ids, omni_asset_usage, ...rest } = storyboard
  const ids = Array.isArray(omni_asset_ids) ? omni_asset_ids.map(Number).filter(Number.isFinite) : []
  const usage = omni_asset_usage || {}
  return {
    ...rest,
    assets: ids.map((asset_id) => ({ asset_id, usage: usage[asset_id] || 'reference' })),
    settings: { ... },
  }
}
```

---

### Bug 6锛歚persistShotOrder()` 鎺掑簭鍚庢湰鍦扮礌鏉愮姸鎬佷涪澶?

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煚 楂?|
| **鏂囦欢** | `frontweb/src/views/FreeCreate.vue` |
| **琛屽彿** | 286 |

**闂鍒嗘瀽**锛?

```javascript
async function persistShotOrder(list) {
  const previous = shots.value
  shots.value = list  // 涔愯鏇存柊
  try {
    const result = isProjectMode.value
      ? await storyboardsAPI.reorder({ episode_id: projectEpisodeId.value, ids: list.map((shot) => shot.id) })
      : await omniVideoAPI.reorderShots(sequence.value.id, list.map((shot) => shot.id))
    shots.value = isProjectMode.value
      ? (result?.storyboards || []).map(projectShot)  // 鈫?鏇挎崲涓烘湇鍔″櫒鍘熷鏁版嵁
      : result
  } catch (error) {
    shots.value = previous  // 鍥炴粴
  }
}
```

椤圭洰妯″紡涓嬶紝`storyboardsAPI.reorder()` 杩斿洖 `result?.storyboards` 鏇挎崲浜嗘暣涓?`shots.value` 鏁扮粍銆傝繖浜涙槸鍘熷 storyboard 瀵硅薄缁忚繃 `projectShot()` 澶勭悊鍚庣殑缁撴灉锛?*浠讳綍鏈寔涔呭寲鍒版湇鍔″櫒鐨勬湰鍦扮姸鎬?*锛堝 `asset.alias` 瑕嗙洊銆乣asset.usage` 瑕嗙洊锛夊湪鎺掑簭鍚庝涪澶便€?

**鍏蜂綋鍦烘櫙**锛?
```
鐢ㄦ埛缁欓暅澶?A 鐨勭礌鏉?X 璁剧疆浜?usage = 'identity'
  鈫?杩欎釜瑕嗙洊鍙瓨鍦ㄤ簬鏈湴鐘舵€侊紙灏氭湭鎸佷箙鍖栧埌 storyboard 鐨?omni_asset_usage_json锛?
  鈫?鐢ㄦ埛鎷栨嫿鎺掑簭
  鈫?persistShotOrder 琚皟鐢?
  鈫?鏈嶅姟鍣ㄨ繑鍥炲師濮嬫暟鎹?
  鈫?shots.value 琚浛鎹?
  鈫?绱犳潗 X 鐨?usage 鎭㈠涓?'reference'
  鈫?鐢ㄦ埛璁剧疆涓㈠け
```

**淇**锛氭帓搴忓悗淇濈暀鏈湴 `asset` 瀵硅薄鐨勮鐩栧瓧娈碉紝涓嶇洿鎺ユ浛鎹?`shots.value`銆?

---

### Bug 7锛歚loadUniversalLibraryAssets()` 鍙姞杞藉墠 200 鏉＄礌鏉?

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煚 楂?|
| **鏂囦欢** | `frontweb/src/views/FilmCreate.vue` |
| **琛屽彿** | 6307 |

**闂鍒嗘瀽**锛?

```javascript
async function loadUniversalLibraryAssets() {
  try {
    const [result, limits] = await Promise.all([
      omniVideoAPI.assets({ page_size: 200 }),  // 鈫?鏈€澶?200 鏉?
      omniVideoAPI.uploadLimits().catch(() => null),
    ])
    universalLibraryAssets.value = (result?.items || []).filter(...)
  } catch (_) {
    universalLibraryAssets.value = []
  }
}
```

瓒呰繃 200 涓礌鏉愭椂锛屽悗闈㈢殑涓嶄細鍑虹幇鍦ㄧ礌鏉愭睜锛屼笖娌℃湁銆屽姞杞芥洿澶氥€嶆垨鍒嗛〉缈婚〉鐨勬満鍒躲€傜敤鎴峰湪濯掍綋搴撲笂浼犱簡澶ч噺绱犳潗鍚庯紝鍦?FilmCreate 涓湅涓嶅埌鍚庨潰涓婁紶鐨勭礌鏉愩€?

**鍚屾牱鐨勯檺鍒朵篃瀛樺湪浜?FreeCreate.vue 绗?117 琛?*锛?
```javascript
const assets = ref([])  // 鍒濆涓虹┖锛岄€氳繃 API 鍔犺浇
```

FreeCreate 鍦?`onMounted` 涓姞杞界礌鏉愭椂锛屼篃鏄€氳繃 `omniVideoAPI.assets({ page_size: 200 })` 鍔犺浇锛屽悓鏍锋湁 200 鏉￠檺鍒躲€?

**淇**锛氬鍔犲垎椤靛姞杞芥垨 `page_size` 璁句负鏇村ぇ鍊硷紙濡?1000锛夛紝鎴栨坊鍔犮€屽姞杞芥洿澶氥€嶆寜閽€?

---

### Bug 8锛歚.webm` 瑙嗛琚綋浣滈煶棰戝鐞?

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煚 楂?|
| **鏂囦欢** | `backend-node/src/services/mediaAssetService.js` |
| **琛屽彿** | 37 |

**闂鍒嗘瀽**锛?

```javascript
// 绗?14-15 琛?
const EXTENSIONS = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  video: ['.mp4', '.webm', '.mov', '.m4v'],  // 娉ㄦ剰锛?webm 鍦?video 鍒楄〃閲?
  audio: ['.mp3', '.wav', '.m4a', '.ogg', '.webm'],  // .webm 涔熷湪 audio 鍒楄〃閲?
};

// 绗?37 琛?鈥?妫€娴嬪嚱鏁?
function detectType(file) {
  const mime = String(file.mimetype || '').toLowerCase();
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (mime.startsWith('image/') || EXTENSIONS.image.includes(ext)) return 'image';
  if (mime.startsWith('video/') || EXTENSIONS.video.includes(ext) && ext !== '.webm') return 'video';
  //                                                                  ^^^^^^^^^^^^^^^^
  //                                                  .webm 琚樉寮忔帓闄ゅ湪瑙嗛妫€娴嬩箣澶栵紒
  if (mime.startsWith('audio/') || EXTENSIONS.audio.includes(ext)) return 'audio';
  return null;
}
```

**鎵ц娴佺▼**锛?
```
涓婁紶 .webm 鏂囦欢锛圡IME: video/webm锛?
  鈫?detectType() 琚皟鐢?
  鈫?mime 浠?'video/' 寮€澶?鈫?鎸?MIME 妫€娴嬩細杩斿洖 'video'
  鈫?浣嗗鏋?MIME 涓嶆槸鏍囧噯鐨?'video/webm'锛堟瘮濡?'application/octet-stream'锛夛細
    鈫?鎸夋墿灞曞悕妫€娴嬶細
    鈫?EXTENSIONS.video.includes('.webm') 鈫?true
    鈫?浣?ext !== '.webm' 鈫?false
    鈫?鎵€浠ユ暣浣撴潯浠朵负 false
    鈫?缁х画妫€鏌?audio锛?
    鈫?EXTENSIONS.audio.includes('.webm') 鈫?true
    鈫?杩斿洖 'audio'
  鈫?.webm 瑙嗛琚綋浣滈煶棰戝鐞?
```

**褰卞搷**锛氫笂浼?WebM 鏍煎紡瑙嗛 鈫?琚娴嬩负闊抽 鈫?鍚庣画澶勭悊锛堝缂╃暐鍥剧敓鎴愩€佹椂闀挎帰娴嬶級鎸夐煶棰戦€昏緫澶勭悊 鈫?鍙兘鍑洪敊鎴栦骇鐢熶笉瀹屾暣鏁版嵁銆?

**淇**锛氬垹闄?`&& ext !== '.webm'`锛屽悓鏃朵粠 `EXTENSIONS.audio` 涓Щ闄?`.webm`銆?

---

## 涓夈€佷腑浼樺厛绾?Bug锛堭煙?8 涓級

> 褰卞搷浣撻獙鎴栫淮鎶ゆ€э紝浣嗕笉闃诲鏍稿績鍔熻兘銆?

---

### Bug 9锛歚DramaDetail.vue` 浣跨敤纭紪鐮侀鑹茶€岄潪 CSS 鍙橀噺

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煛 涓?|
| **鏂囦欢** | `frontweb/src/views/DramaDetail.vue` |
| **琛屽彿** | 1220-1225 |

**闂鍒嗘瀽**锛?

```css
.drama-detail {
  min-height: 100vh;
  background: #0f0f12;  /* 纭紪鐮佹繁鑹?*/
  background-image:
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(120, 60, 220, 0.18) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(60, 100, 220, 0.12) 0%, transparent 60%);
  color: #e4e4e7;  /* 纭紪鐮佹枃瀛楄壊 */
}
```

`theme.css` 宸插畾涔夌粺涓€鐨?`--bg-page`銆乣--text-primary` 绛夊彉閲忥紝浣?DramaDetail 椤甸潰浠嶇劧浣跨敤纭紪鐮侀鑹层€傝櫧鐒?`theme.css` 绗?142 琛岀敤 `!important` 瑕嗙洊浜嗚儗鏅壊锛?

```css
html body #app .drama-detail { background: var(--bg-page) !important; color: var(--text-primary) !important; }
```

浣?*娓愬彉鑳屾櫙涓嶄細琚鐩?*锛屽鑷村湪缁熶竴娣辫壊涓婚涓嬪嚭鐜扮传鑹叉笎鍙樿儗鏅紝涓庡叾浠栭〉闈㈢殑绾壊鑳屾櫙涓嶄竴鑷淬€?

**淇**锛氫娇鐢?CSS 鍙橀噺鏇夸唬纭紪鐮侀鑹诧紝骞剁Щ闄ゆ笎鍙樿儗鏅垨浣垮叾璺熼殢涓婚鍙橀噺銆?

---

### Bug 10锛氬墠绔姹傛嫤鎴櫒鍙鐞嗕簡 413 鐘舵€佺爜

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煛 涓?|
| **鏂囦欢** | `frontweb/src/utils/request.js` |
| **琛屽彿** | 22-38 |

**闂鍒嗘瀽**锛?

```javascript
request.interceptors.response.use(
  (response) => { /* ... */ },
  (error) => {
    const status = error.response?.status
    if (status === 413) {
      // 鍙鐞嗕簡 413
      const msg413 = '涓婁紶鏂囦欢杩囧ぇ锛?13锛夛紝璇峰帇缂╁浘鐗囧埌 16MB 浠ュ唴鍚庨噸璇?
      ElMessage.error(msg413)
      error.message = msg413
      return Promise.reject(error)
    }
    const backendMsg = error.response?.data?.error?.message
    const msg = backendMsg || error.message || '缃戠粶閿欒'
    ElMessage.error(msg)
    if (backendMsg) error.message = backendMsg
    return Promise.reject(error)
  }
)
```

瀹¤鏂囨。绗?6.5 鑺傚缓璁簡瀹屾暣鐨勯敊璇槧灏勮〃锛屼絾灏氭湭瀹炵幇锛?

| 鐘舵€佺爜 | 搴旇鏄剧ず | 瀹為檯鏄剧ず |
|--------|---------|---------|
| 401 | 鐧诲綍宸茶繃鏈燂紝璇烽噸鏂扮櫥褰?| 鍚庣鍘熷閿欒淇℃伅 |
| 403 | 娌℃湁鏉冮檺鎵ц姝ゆ搷浣?| 鍚庣鍘熷閿欒淇℃伅 |
| 404 | 璇锋眰鐨勮祫婧愪笉瀛樺湪 | 鍚庣鍘熷閿欒淇℃伅 |
| 413 | 涓婁紶鏂囦欢杩囧ぇ... | 鉁?宸插鐞?|
| 429 | 璇锋眰杩囦簬棰戠箒锛岃绋嶅悗鍐嶈瘯 | 鍚庣鍘熷閿欒淇℃伅 |
| 500 | 鏈嶅姟鍣ㄥ唴閮ㄩ敊璇紝璇风◢鍚庨噸璇?| 鍚庣鍘熷閿欒淇℃伅锛堝彲鑳芥毚闇插疄鐜扮粏鑺傦級 |
| 502 | 鏈嶅姟鏆傛椂涓嶅彲鐢?| 鍚庣鍘熷閿欒淇℃伅 |
| 503 | 鏈嶅姟姝ｅ湪缁存姢 | 鍚庣鍘熷閿欒淇℃伅 |

**淇**锛氳ˉ鍏呭畬鏁寸殑鐘舵€佺爜鏄犲皠琛紝骞剁‘淇?500 閿欒涓嶆毚闇插悗绔敊璇粏鑺傘€?

---

### Bug 11锛歚DramaDetail.vue` 鐨?`doGenerateLibImg` 杞寰幆杩囦簬婵€杩?

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煛 涓?|
| **鏂囦欢** | `frontweb/src/views/DramaDetail.vue` |
| **琛屽彿** | 639-645 |

**闂鍒嗘瀽**锛?

```javascript
async function doGenerateLibImg(form, prompt, api, reloadFn) {
  form.imgGenerating = true
  try {
    const res = await imagesAPI.create({ ... })
    const taskId = imgData?.task_id
    // ...
    for (let i = 0; i < 300; i++) {          // 300 娆?
      await new Promise(r => setTimeout(r, 1500))  // 姣忔 1.5 绉?
      const tr = await taskAPI.get(taskId)    // 杞
      if (task.status === 'completed') break
      if (task.status === 'failed') throw new Error(...)
    }
    // ...
  } finally { form.imgGenerating = false }
}
```

**闂**锛?

1. **300 娆?脳 1.5 绉?= 7.5 鍒嗛挓**锛屾暣涓嚱鏁颁細闃诲杩欎箞涔呮墠瓒呮椂锛屾湡闂寸敤鎴锋棤娉曡繘琛屽叾浠栨搷浣?
2. 涓?`generationTaskStore.js` 鐨勮疆璇㈡満鍒讹紙闂撮殧 2 绉掞紝鏈€澶?450 娆?= 15 鍒嗛挓锛?*涓嶄竴鑷?*锛岀淮鎶や袱濂楄疆璇㈤€昏緫
3. 娌℃湁浣跨敤 `generationTaskStore` 鐨勫叡浜疆璇㈡満鍒讹紝**姣忔璋冪敤閮界嫭绔嬭疆璇?*锛屾氮璐硅祫婧?
4. 椤甸潰鍒囨崲涓嶄細鍙栨秷杞锛?*缁勪欢鍗歌浇鍚庤疆璇粛鍦ㄧ户缁?*

**淇**锛氭敼鐢?`generationTaskStore.pollTask()` 鍏变韩杞鏈哄埗銆?

---

### Bug 12锛歚omniSequenceService` 涓嶅厑璁稿垹闄ゆ渶鍚庝竴涓暅澶?

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煛 涓?|
| **鏂囦欢** | `backend-node/src/services/omniSequenceService.js` |
| **琛屽彿** | 102 |

**闂鍒嗘瀽**锛?

```javascript
function deleteShot(db, sequenceId, shotId) {
  const shots = listShots(db, sequenceId)
  if (shots.length <= 1) throw new Error('鑷冲皯淇濈暀涓€涓暅澶?)
  // ...
}
```

涓嶅厑璁稿垹闄ゆ渶鍚庝竴涓暅澶达紝浣嗗墠绔病鏈夋彁渚涖€屾竻绌洪暅澶村唴瀹广€嶇殑鏇夸唬鏂规銆傜敤鎴峰垹鍒板彧鍓╀竴涓暅澶存椂锛屽垹闄ゆ寜閽偣鍑诲悗鎶ラ敊锛屼絾娌℃湁鎻愮ず涓轰粈涔堜笉鍙敤銆?

**鍓嶇琛ㄧ幇**锛氱敤鎴风偣鍑诲垹闄ゆ渶鍚庝竴涓暅澶?鈫?鍚庣杩斿洖 400 + "鑷冲皯淇濈暀涓€涓暅澶? 鈫?鍓嶇鏄剧ず閿欒娑堟伅 鈫?鐢ㄦ埛鍥版儜銆?

**淇鏂规**锛?
- 鏂规 A锛氬厑璁稿垹闄わ紝鍒犻櫎鍚庤嚜鍔ㄥ垱寤轰竴涓┖鐧介暅澶达紙鎺ㄨ崘锛?
- 鏂规 B锛氬墠绔湪鍙墿涓€涓暅澶存椂绂佺敤鍒犻櫎鎸夐挳骞舵樉绀?tooltip 鎻愮ず

---

### Bug 13锛氫笂浼犲浘鐗囧ぇ灏忛檺鍒朵笉涓€鑷?

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煛 涓?|
| **鏂囦欢** | `backend-node/src/routes/upload.js`锛堢 11 琛岋級vs `backend-node/src/services/mediaAssetService.js`锛堢 10 琛岋級 |

**闂鍒嗘瀽**锛?

```javascript
// upload.js 绗?11 琛?鈥?鑰佷笂浼犺矾寰?
const MAX_IMAGE_SIZE_MB = 16;
const maxSize = MAX_IMAGE_SIZE_MB * 1024 * 1024;  // 16MB

// mediaAssetService.js 绗?10 琛?鈥?鏂颁笂浼犺矾寰?
const LIMITS = { image: 30, video: 50, audio: 15 };  // 30MB
```

涓や釜涓婁紶璺緞鏈変笉鍚岄檺鍒讹細

| 璺緞 | 鍥剧墖闄愬埗 | 瑙嗛闄愬埗 | 闊抽闄愬埗 |
|------|---------|---------|---------|
| `POST /upload/image` | 16MB | - | - |
| `POST /media/upload` | 30MB | 50MB | 15MB |

鍓嶇 `uploadLimits` API 杩斿洖鐨勬槸 30MB锛堟潵鑷?`mediaAssetService.js`锛夛紝浣嗗鏋滅敤鎴烽€氳繃 `POST /upload/image`锛堣€佽矾寰勶紝鐢ㄤ簬瑙掕壊/鍦烘櫙/閬撳叿鍥句笂浼狅級涓婁紶 25MB 鐨勫浘鐗囷紝浼氳 multer 鎷掔粷銆?

**淇**锛氱粺涓€涓や釜璺緞鐨勯檺鍒讹紝鎴栧簾寮冭€佽矾寰勩€?

---

### Bug 14锛氫富棰樺垏鎹㈡寜閽 `theme.css` 闅愯棌浣嗕粛鍦?DOM 涓?

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煛 涓?|
| **鏂囦欢** | `frontweb/src/views/DramaDetail.vue`锛堢 15-18 琛岋級+ `frontweb/src/styles/theme.css`锛堢 170 琛岋級 |

**闂鍒嗘瀽**锛?

```html
<!-- DramaDetail.vue 绗?15-18 琛?鈥?娓叉煋浜嗘寜閽?-->
<el-button class="btn-theme" :title="isDark ? '鍒囨崲鍒版祬鑹叉ā寮? : '鍒囨崲鍒版殫鑹叉ā寮?" @click="toggleTheme">
  <el-icon><Sunny v-if="isDark" /><Moon v-else /></el-icon>
  {{ isDark ? '娴呰壊' : '鏆楄壊' }}
</el-button>
```

```css
/* theme.css 绗?170 琛?鈥?寮哄埗闅愯棌 */
html body #app .btn-theme { display: none !important; }
```

DramaDetail 娓叉煋浜?`btn-theme` 鎸夐挳锛屼絾 `theme.css` 寮哄埗 `display: none` 闅愯棌浜嗗畠銆傜敤鎴风湅鍒版寜閽絾鐐瑰嚮鏃犳晥锛岄€犳垚鍥版儜銆?

**淇**锛氫粠妯℃澘涓Щ闄よ鎸夐挳锛屾垨浠?`theme.css` 涓Щ闄ら殣钘忚鍒欍€?

---

### Bug 15锛歚DramaDetail.vue` 鐨?`loadDrama()` 涓嶅姞杞?assets

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煛 涓?|
| **鏂囦欢** | `frontweb/src/views/DramaDetail.vue` |
| **琛屽彿** | 899-916 |

**闂鍒嗘瀽**锛?

```javascript
async function loadDrama() {
  loading.value = true
  try {
    let d = await dramaAPI.get(dramaId)
    d = await backfillDramaStylePromptMetadataIfNeeded(dramaAPI, dramaId, d)
    drama.value = d
    episodes.value = d.episodes || []
    infoForm.title = d.title || ''
    // ... 娌℃湁鍔犺浇 assets
  } catch (e) {
    ElMessage.error(e.message || '鍔犺浇澶辫触')
  } finally {
    loading.value = false
  }
}
```

鍙姞杞戒簡 `dramaAPI.get()` 杩斿洖鐨?drama 鏁版嵁锛坋pisodes/characters/scenes/props锛夛紝娌℃湁鍔犺浇 `assets` 琛ㄦ暟鎹€傚綋鐢ㄦ埛鍦?DramaDetail 椤甸潰绠＄悊瑙掕壊/鍦烘櫙/閬撳叿鐨勫浘鐗囨椂锛岃繖浜涘浘鐗囩殑 `assets` 璁板綍浠庢湭琚垱寤烘垨鍚屾锛屽鑷村悗缁湪 FreeCreate 涓娇鐢ㄦ椂闇€瑕?`ensureProjectResourceAssets()` 閲嶆柊鎵嬪姩鍚屾銆?

**淇**锛氬湪 `loadDrama()` 涓ˉ鍏呭姞杞?assets 鐨勯€昏緫锛屾垨閰嶅悎 Bug 3 鐨?`assetMappingService` 瀹炵幇鑷姩鍚屾銆?

---

### Bug 16锛歚FilmCreate.vue` 鐨?`loadDrama()` 鏈鐞?`projectEpisodeId` 鍙傛暟

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煛 涓?|
| **鏂囦欢** | `frontweb/src/views/FilmCreate.vue` |
| **琛屽彿** | 4662-4709 |

**闂鍒嗘瀽**锛?

`loadDrama()` 鍑芥暟鎺ュ彈 `route.params.id` 浣滀负 drama ID锛屼絾 `FilmCreate.vue` 涔熷彲浠ラ€氳繃 `?episode_id=` 鍙傛暟鎸囧畾鍓ч泦銆傚綋鐢ㄦ埛閫氳繃 FreeCreate 鐨勩€岃繑鍥為」鐩€嶉摼鎺ュ洖鍒?FilmCreate 鏃讹細

```javascript
// FreeCreate.vue 绗?199-201 琛?
function backToProject() {
  if (isProjectMode.value && projectDramaId.value) router.push(`/film/${projectDramaId.value}`)
  else router.push('/')
}
```

杩欎釜閾炬帴鍙紶浜?drama ID锛屾病鏈変紶 `episode_id` 鍙傛暟銆傚鏋滅敤鎴蜂箣鍓嶅湪 FilmCreate 涓煡鐪嬬殑鏄 3 闆嗭紝鍥炲埌鍒楄〃鍐嶈繘鏉ユ椂榛樿璺冲埌绗?1 闆嗭紝鑰屼笉鏄浣忎箣鍓嶆煡鐪嬬殑鏄摢涓€闆嗐€?

**淇**锛氬湪 `backToProject()` 涓惡甯?`episode_id` 鍙傛暟锛屾垨浣跨敤 `vue-router` 鐨?`replace` 鏂规硶淇濈暀褰撳墠 query銆?

---

## 鍥涖€佷綆浼樺厛绾?/ 浠ｇ爜璐ㄩ噺锛堭煙?3 涓級

> 涓嶅奖鍝嶅姛鑳斤紝浣嗗奖鍝嶅彲缁存姢鎬у拰浠ｇ爜鍋ュ．鎬с€?

---

### Bug 17锛歚task` 鍙橀噺鍒涘缓鏈娇鐢?

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煝 浣?|
| **鏂囦欢** | `backend-node/src/services/omniVideoService.js` |
| **琛屽彿** | 21 |

**闂鍒嗘瀽**锛?

```javascript
function create(db, log, body) {
  // ...
  const task = taskService.createTask(db, log, 'video_generation', '');  // 鈫?鍒涘缓浜?task
  // ...
  const result = db.prepare(`INSERT INTO video_generations (..., task_id, ...)
    VALUES (..., ?, ...)`)
    .run(/* ... */, task.id, /* ... */);  // 鈫?瀹為檯浣跨敤浜?task.id
  // ...
}
```

绛夌瓑锛岃鎴戦噸鏂版鏌ヤ竴涓?... 绗?31 琛岀‘瀹炰娇鐢ㄤ簡 `task.id`锛?

```javascript
// 绗?26-31 琛?
const result = db.prepare(`INSERT INTO video_generations (..., task_id, ...)
    VALUES (..., ?, ...)`)
    .run(/* ... 鍓嶉潰鐨勫弬鏁?... */, task.id, /* ... 鍚庨潰鐨勫弬鏁?... */);
```

鎵€浠?`task` 鍙橀噺瀹為檯涓婃槸琚娇鐢ㄧ殑銆傝繖涓笉鏄?Bug銆傝鎴戠Щ闄よ繖涓潯鐩€?

---

### Bug 17锛堜慨姝ｏ級锛歚isDark` / `toggleTheme` 鍙兘鏈畾涔?

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煝 浣?|
| **鏂囦欢** | `frontweb/src/views/DramaDetail.vue` |
| **琛屽彿** | 15 |

**闂鍒嗘瀽**锛?

```html
<el-button
  class="btn-theme"
  :title="isDark ? '鍒囨崲鍒版祬鑹叉ā寮? : '鍒囨崲鍒版殫鑹叉ā寮?"
  @click="toggleTheme"
>
```

`isDark` 鍜?`toggleTheme` 鍦ㄦā鏉夸腑浣跨敤锛屼絾 `<script setup>` 涓病鏈夊搴旂殑瀹氫箟鎴栧鍏ャ€傚鏋滃畠浠潵鑷煇涓?composable 鎴栧叏灞€鍙橀噺锛屼絾娌℃湁鏄惧紡瀵煎叆锛岃繍琛屾椂浼氭姤 `isDark is not defined` 鐨勯敊璇€?

**妫€鏌?`<script setup>` 涓殑瀵煎叆**锛堢 563 琛岄檮杩戯級锛?
```javascript
import { ref, reactive, onMounted, watch, computed } from 'vue'
// 娌℃湁 import useTheme 鎴栫被浼?
```

濡傛灉 `useTheme` composable 瀛樺湪浣嗘湭瀵煎叆锛屼細瀵艰嚧杩愯鏃堕敊璇€?

**淇**锛氱‘璁?`isDark` 鍜?`toggleTheme` 鐨勬潵婧愶紝濡傛灉鏄凡搴熷純鐨勫姛鑳斤紝浠庢ā鏉夸腑绉婚櫎銆?

---

### Bug 18锛氶殣钘忔寜閽殑鐐瑰嚮浜嬩欢浠嶅彲瑙﹀彂

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煝 浣?|
| **鏂囦欢** | `frontweb/src/views/DramaDetail.vue` + `frontweb/src/styles/theme.css`锛堢 170 琛岋級 |

**闂鍒嗘瀽**锛?

`btn-theme` 鎸夐挳琚?`display: none` 闅愯棌锛屼絾 `@click="toggleTheme"` 缁戝畾浠嶇劧瀛樺湪銆傞€氳繃 DevTools 鍙栨秷闅愯棌鍚庣偣鍑伙紝鍙兘瑙﹀彂鏈畾涔夋垨宸插簾寮冪殑涓婚鍒囨崲鍑芥暟锛屽鑷撮〉闈㈡牱寮忔贩涔便€?

**淇**锛氱Щ闄ゆā鏉夸腑鐨勬寜閽垨绉婚櫎 CSS 涓殑闅愯棌瑙勫垯锛屼袱鑰呬繚鎸佸悓姝ャ€?

---

### Bug 19锛歚DramaDetail.vue` 鐨?`onMounted` 娌℃湁娓呯悊瀹氭椂鍣?

| 灞炴€?| 鍊?|
|------|------|
| **涓ラ噸绋嬪害** | 馃煝 浣?|
| **鏂囦欢** | `frontweb/src/views/DramaDetail.vue` |
| **琛屽彿** | 1206-1214 |

**闂鍒嗘瀽**锛?

```javascript
onMounted(() => {
  loadDrama()
  loadCharList()
  if (route.query.importBatch) {
    setTimeout(() => {
      episodeBatchImportDialogRef.value?.openDialog?.()
    }, 0)
  }
})
```

`onMounted` 涓娇鐢ㄤ簡 `setTimeout`锛屼絾娌℃湁鍦?`onBeforeUnmount` 涓竻鐞嗐€傚鏋滅粍浠跺湪瀹氭椂鍣ㄨЕ鍙戝墠琚嵏杞斤紝瀹氭椂鍣ㄤ細灏濊瘯璁块棶宸插嵏杞界殑 DOM 寮曠敤锛坄episodeBatchImportDialogRef.value`锛夛紝鍙兘寮曞彂鍐呭瓨娉勬紡銆?

**淇**锛氫繚瀛樺畾鏃跺櫒寮曠敤骞跺湪 `onBeforeUnmount` 涓竻鐞嗐€?

---

## 浜斻€佷慨澶嶄紭鍏堢骇姹囨€?

### 鎸夊奖鍝嶈寖鍥存帓搴?

```
浼樺厛绾?       Bug ID    鏍囬                                    淇鎴愭湰
鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€    鈹€鈹€鈹€鈹€鈹€鈹€    鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€    鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
绗竴浼樺厛        1       鍚庣灏惧抚楠岃瘉                             1 琛?
锛堟暟鎹涪澶?     2       棣栧抚/灏惧抚鍒囨崲涓㈠け                       40 琛?
 鍔熻兘涓嶅彲鐢級   4       local_path 瀛?null                      4 琛?
                3       绱犳潗鏈悓姝ュ埌 assets 琛?                 鏂板缓鏈嶅姟 ~200 琛?

绗簩浼樺厛        8       .webm 琚綋闊抽                         1 琛?
锛堜綋楠屼弗閲?     10      璇锋眰鎷︽埅鍣ㄥ彧澶勭悊 413                    ~30 琛?
 鍙楁崯锛?        5       projectShot 灞曞紑鍘熷瀛楁                ~10 琛?
                11      doGenerateLibImg 杞婵€杩?             ~50 琛?
                14      涓婚鎸夐挳琚殣钘?                        绉婚櫎鎸夐挳鎴?CSS
                16      鍙傛暟浼犻€掗棶棰?                           ~20 琛?

绗笁浼樺厛        7       绱犳潗鍙姞杞?200 鏉?                     ~30 琛?
锛堜綋楠屼紭鍖栵級    13      涓婁紶闄愬埗涓嶄竴鑷?                        缁熶竴鍊?
                6       鎺掑簭鍚庣姸鎬佷涪澶?                         ~30 琛?
                9       CSS 鍙橀噺缁熶竴                            ~20 琛?
                12      鍒犻櫎闀滃ご鎻愮ず                            ~10 琛?
                15      loadDrama 涓嶅姞杞?assets                 ~20 琛?
                17-19   浠ｇ爜娓呯悊                                ~30 琛?
```

### 鎸夋枃浠剁儹鐐规帓搴?

```
鏂囦欢                                   Bug 鏁伴噺    绱淇鎴愭湰
鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€  鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€    鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
frontweb/src/views/FreeCreate.vue         3          ~80 琛?
frontweb/src/views/DramaDetail.vue        6          ~100 琛?
frontweb/src/views/FilmCreate.vue         2          ~50 琛?
backend-node/src/services/...             3          ~200 琛?
frontweb/src/utils/request.js             1          ~30 琛?
frontweb/src/styles/theme.css             1          ~5 琛?
```

---

## 鍏€佷慨澶嶈矾绾垮浘

### Phase 1锛氱揣鎬ヤ慨澶嶏紙寤鸿 1-2 澶╋級

> 瑙ｅ喅鏁版嵁涓㈠け鍜屽姛鑳戒笉鍙敤鐨勯棶棰樸€?

| 椤哄簭 | Bug | 鎿嶄綔 | 椋庨櫓 |
|------|-----|------|------|
| 1 | Bug 1锛氬悗绔熬甯ч獙璇?| 鏀?1 琛?| 浣?|
| 2 | Bug 4锛歚local_path: null` | 鏀?4 琛?| 浣?|
| 3 | Bug 2锛氶甯?灏惧抚鍒囨崲涓㈠け | 鏀?`projectShot` + `loadShot` | 涓紙闇€娴嬭瘯鍒囨崲閫昏緫锛?|
| 4 | Bug 3锛氬垱寤?`assetMappingService` | 鏂板缓鏈嶅姟 + 闆嗘垚鍒板悇 Service | 楂橈紙闇€纭繚涓嶇牬鍧忕幇鏈変繚瀛橀€昏緫锛?|

### Phase 2锛氫綋楠屼慨澶嶏紙寤鸿 3-5 澶╋級

> 瑙ｅ喅涓ラ噸褰卞搷鐢ㄦ埛浣撻獙鐨勯棶棰樸€?

| 椤哄簭 | Bug | 鎿嶄綔 | 椋庨櫓 |
|------|-----|------|------|
| 5 | Bug 8锛歚.webm` 妫€娴?| 鏀?1 琛?| 浣?|
| 6 | Bug 10锛氬寮洪敊璇鐞?| 鏀?`request.js` | 浣?|
| 7 | Bug 5锛歚projectShot` 灞曞紑 | 鏀?`projectShot` | 浣?|
| 8 | Bug 11锛氭敼鐢ㄥ叡浜疆璇?| 鏀?`doGenerateLibImg` | 涓?|
| 9 | Bug 14锛氱Щ闄ら殣钘忔寜閽?| 鏀规ā鏉挎垨 CSS | 浣?|
| 10 | Bug 16锛氬弬鏁颁紶閫?| 鏀?`backToProject` | 浣?|

### Phase 3锛氫紭鍖栦慨澶嶏紙寤鸿 1-2 鍛級

> 瑙ｅ喅浣撻獙浼樺寲鍜屼唬鐮佽川閲忛棶棰樸€?

| 椤哄簭 | Bug | 鎿嶄綔 | 椋庨櫓 |
|------|-----|------|------|
| 11 | Bug 7锛氬垎椤靛姞杞?| 鍔犲垎椤甸€昏緫 | 浣?|
| 12 | Bug 13锛氱粺涓€涓婁紶闄愬埗 | 缁熶竴鍊?| 浣?|
| 13 | Bug 6锛氭帓搴忎繚鐣欑姸鎬?| 鏀?`persistShotOrder` | 涓?|
| 14 | Bug 9锛欳SS 鍙橀噺 | 鏀?`DramaDetail.vue` | 浣?|
| 15 | Bug 12锛氬垹闄ら暅澶存彁绀?| 鏀瑰悗绔?+ 鍓嶇 | 浣?|
| 16 | Bug 15锛歚loadDrama` 琛ュ叏 | 鍔?assets 鍔犺浇 | 浣?|
| 17 | Bug 17-19锛氫唬鐮佹竻鐞?| 娓呯悊妯℃澘鍜屽畾鏃跺櫒 | 浣?|

---

> **鏂囨。缁存姢鑰?*锛欳laude Code (LocalMiniDrama Deployer)
> **鏈€鍚庢洿鏂?*锛?026-08-04
> **鍏宠仈鏂囨。**锛歔2026-08-04-architecture-audit-and-improvement.md](./2026-08-04-architecture-audit-and-improvement.md)
