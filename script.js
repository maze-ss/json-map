const map = L.map('map', {
  center: [36.39, 139.06],
  zoom: 12,
  maxZoom: 20
});

// OpenStreetMapレイヤー（タイルはz=18まで、z=20で拡大表示）
let osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  maxNativeZoom: 18, // ← z=18までしかタイルがないのでこれを指定
  attribution: '© OpenStreetMap contributors'
});

// 地理院地図（淡色地図）（タイルはz=18まで、z=20で拡大表示）
let gsiLayer = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
  maxZoom: 20,
  maxNativeZoom: 18, // ← z=18までしかタイルがないのでこれを指定
  attribution: '地理院地図（国土地理院）'
});

// 地図にOSMレイヤーを初期表示として追加
let currentBaseLayer = osmLayer.addTo(map);

// 地図レイヤー切り替え
document.querySelectorAll('input[name="baseMap"]').forEach((radio) => {
  radio.addEventListener('change', (event) => {
    setBaseMap(event.target.value);
  });
});

function setBaseMap(type) {
  map.removeLayer(currentBaseLayer);
  currentBaseLayer = (type === 'osm') ? osmLayer : gsiLayer;
  currentBaseLayer.addTo(map);
  if (type === 'osm') {
    console.log('OpenStreetMapに切り替え');
    // OSM表示処理
  } else if (type === 'gsi') {
    console.log('地理院地図に切り替え');
    // 地理院地図表示処理
  }
}

// マーカークラスタグループ
const markersCluster = L.markerClusterGroup({
  maxClusterRadius: 40 // デフォルトは80、数値を小さくすると吸着が弱くなる
});
map.addLayer(markersCluster);

let imageMarkers = []; // { marker, file, imgEl }

// 画像をドロップで読み込み
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  handleFiles(e.dataTransfer.files);
});

async function handleFiles(files) {
  const latlngs = [];
  const noLocationContainer = document.getElementById("no-location-images");

  for (let file of files) {
    const ext = file.name.toLowerCase().split('.').pop();

    // === [GeoJSON 処理] ===
    if (ext === 'geojson' || ext === 'json') {
      const text = await file.text();
      try {
        const geojson = JSON.parse(text);

        // --- propertiesのキー一覧を抽出 ---
        let propertyKeys = new Set();
        if (geojson.features && Array.isArray(geojson.features)) {
          geojson.features.forEach(f => {
            if (f.properties) {
              Object.keys(f.properties).forEach(k => propertyKeys.add(k));
            }
          });
        }
        propertyKeys = Array.from(propertyKeys);

        // --- モーダル表示 ---
        const modal = document.getElementById('geojsonModal');
        const selectDiv = document.getElementById('geojson-prop-select');
        selectDiv.innerHTML = '';
        const label = document.createElement('label');
        label.textContent = 'ラベルに使う属性: ';
        const select = document.createElement('select');
        propertyKeys.forEach(k => {
          const opt = document.createElement('option');
          opt.value = k;
          opt.textContent = k;
          select.appendChild(opt);
        });
        label.appendChild(select);
        selectDiv.appendChild(label);
        modal.style.display = 'block';

        // モーダル閉じる処理
        document.getElementById('geojsonModalClose').onclick = () => {
          modal.style.display = 'none';
        };
        modal.onclick = (e) => {
          if (e.target === modal) modal.style.display = 'none';
        };

        // ポリゴン色
        const polyColor = "blue";

        // レイヤー生成関数
        function addGeoJsonLayer(propKey) {
          // 既存レイヤー削除
          if (window._geojsonLayer) {
            map.removeLayer(window._geojsonLayer);
          }
          window._geojsonLayer = L.geoJSON(geojson, {
            style: {
              color: polyColor,
              weight: 2,
              fillOpacity: 0.2
            },
            onEachFeature: function (feature, lyr) {
              if (feature.geometry.type === "Polygon") {
                // LeafletのLatLngsを[lat, lng]配列に変換
                const latlngs = lyr.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
                // 重心を計算
                const center = lyr.getBounds().getCenter();
                let labelPos = [center.lat, center.lng];
                // 中心がポリゴン外なら、最初の頂点を使う
                if (!isPointInPolygon(labelPos, latlngs)) {
                  labelPos = latlngs[0];
                }
                // ラベル表示
                const text = feature.properties && feature.properties[propKey] ? feature.properties[propKey] : '';
                if (text) {
                  const label = L.marker(labelPos, {
                    icon: L.divIcon({
                      className: 'geojson-label',
                      html: `<span style="color:${polyColor};font-weight:bold;text-shadow:1px 1px 2px #fff;">${text}</span>`,
                      iconSize: [100, 24],
                      iconAnchor: [50, 12]
                    }),
                    interactive: false
                  });
                  label.addTo(map);
                  lyr.on('remove', () => map.removeLayer(label));
                }
              }
              // MultiPolygon対応も同様に可能
            }
          }).addTo(map);
          map.fitBounds(window._geojsonLayer.getBounds());
        }

        // 初期表示
        addGeoJsonLayer(select.value);

        // 選択変更時
        select.onchange = () => {
          addGeoJsonLayer(select.value);
          modal.style.display = 'none'; // 選択後モーダルを閉じる
        };

      } catch (err) {
        alert(`GeoJSONの読み込みエラー: ${file.name}`);
        console.error(err);
      }
      continue;
    }

    // === [画像ファイル処理] ===
    if (!file.type.startsWith("image/")) continue;
    const exif = await exifr.gps(file).catch(() => null);

    if (exif && exif.latitude && exif.longitude) {
      const latlng = [exif.latitude, exif.longitude];
      latlngs.push(latlng);
      placeMarker(file, latlng);
    } else {
      // 手動配置が必要な画像
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.className = 'thumbnail';
      img.title = "マップ上にドラッグで配置";
      img.onclick = () => {
        map.once("click", (e) => {
          placeMarker(file, [e.latlng.lat, e.latlng.lng]);
          img.remove();
        });
      };
      noLocationContainer.appendChild(img);
    }
  }

  if (latlngs.length > 0) {
    const avgLat = latlngs.reduce((a, b) => a + b[0], 0) / latlngs.length;
    const avgLng = latlngs.reduce((a, b) => a + b[1], 0) / latlngs.length;
    map.setView([avgLat, avgLng], 16);
  }
}

// ピンを配置し、クリックでサムネイル表示 → 拡大
function placeMarker(file, latlng) {
  const marker = L.marker(latlng, { draggable: true });
  const thumbUrl = URL.createObjectURL(file);

  // ポップアップに画像とクリックイベントを設定
  const popupContent = document.createElement('div');

  const img = document.createElement('img');
  img.src = thumbUrl;
  img.style.width = '150px';
  img.style.cursor = 'pointer';
  popupContent.appendChild(img);
  // 画像ファイル名を表示 ファイル名が長すぎる場合は16文字で省略
  const fileNameDiv = document.createElement('div');
  fileNameDiv.textContent = file.name.length > 16 ? file.name.slice(0, 16) + '...' : file.name;
  fileNameDiv.style.fontSize = '8px';
  fileNameDiv.style.marginTop = '2px';
  popupContent.appendChild(fileNameDiv);

  img.addEventListener('click', (e) => {
    e.stopPropagation(); // マップへのイベントバブリングを防止
    const win = window.open();
    win.document.write(`<img src="${thumbUrl}" style="max-width:97vw; display:block; margin:auto;">`);
    win.document.write(`<div style="font-size:20px; margin-top:2px; text-align:center;">${file.name}</div>`);
  });


  marker.bindPopup(popupContent);

  markersCluster.addLayer(marker);
  imageMarkers.push({ marker, file });
}

// マップクリックで全ポップアップを閉じる
map.on('click', () => {
  map.closePopup();
});

// ピン位置からEXIFを更新し、ダウンロード
async function downloadUpdatedPhotos() {
  for (const { marker, file } of imageMarkers) {
    const latlng = marker.getLatLng();
    const updatedFile = await updateExifLocation(file, latlng.lat, latlng.lng);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(updatedFile);
    a.download = file.name.replace(/\.jpg$/i, '_updated.jpg');
    a.click();
  }
}

// piexifを使ってJPEGの位置情報を更新
async function updateExifLocation(file, lat, lng) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const jpegData = reader.result;
      const exifObj = piexif.load(jpegData);
      exifObj["GPS"] = createGpsExif(lat, lng);
      const exifBytes = piexif.dump(exifObj);
      const updatedData = piexif.insert(exifBytes, jpegData);
      const blob = new Blob([dataURLToBinary(updatedData)], { type: "image/jpeg" });
      resolve(blob);
    };
    reader.readAsDataURL(file);
  });
}

// EXIF用GPS情報を生成
function createGpsExif(lat, lng) {
  function toDMS(val) {
    const d = Math.floor(val);
    const m = Math.floor((val - d) * 60);
    const s = Math.floor(((val - d - m / 60) * 3600) * 100);
    return [[d, 1], [m, 1], [s, 100]];
  }
  return {
    1: lat >= 0 ? "N" : "S",
    2: toDMS(Math.abs(lat)),
    3: lng >= 0 ? "E" : "W",
    4: toDMS(Math.abs(lng)),
  };
}

// Base64 DataURL → バイナリへ
function dataURLToBinary(dataurl) {
  const byteString = atob(dataurl.split(',')[1]);
  const buffer = new ArrayBuffer(byteString.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < byteString.length; i++) {
    view[i] = byteString.charCodeAt(i);
  }
  return buffer;
}

// ヒントモーダルの表示
function showHint() {
  document.getElementById('hintModal').style.display = 'block';
}

function closeHint() {
  document.getElementById('hintModal').style.display = 'none';
}

// モーダル外クリックで閉じる
window.onclick = function (event) {
  const modal = document.getElementById('hintModal');
  if (event.target == modal) {
    modal.style.display = "none";
  }
}

// --- Point in Polygon関数を追加 ---
function isPointInPolygon(point, polygon) {
  let x = point[1], y = point[0];
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    let xi = polygon[i][1], yi = polygon[i][0];
    let xj = polygon[j][1], yj = polygon[j][0];
    let intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-10) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
