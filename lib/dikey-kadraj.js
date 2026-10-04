// DIKEY KADRAJ — Shorts icin tam ekran 9:16 kadraj filtreleri (Failure Reconstructed).
//
// Eskiden her goruntu bulanik bir arka planin ORTASINA yerlestiriliyordu: yatay bir
// arsiv fotografi ekranin ~%42'sini kapliyor, kalan alan bulanik bant oluyordu
// (Shorts akisinda "slayt gosterisi" hissi, ilk karede zayif goruntu).
//
//   Fotograf: ekrani TAMAMEN doldurur. Yatay fotografta 9:16 pencere fotografin
//             uzerinde yavasca saga/sola kayar (pan) — hem hareket hem de goruntunun
//             tamami ekrana gelir. Dikey/kareye yakin fotografta yavas yakinlasma.
//   Video:    dikey (<= 0.6 en/boy) klip tam ekran; yatay klip ekran yuksekliginin
//             ~%60'ini kaplayacak kadar buyutulur (yanlar kirpilir), bulanik dolgu
//             yalnizca kalan bantlarda.
//   Arsiv:    siyah-beyaz/soluk fotograflarda hafif kontrast + keskinlik (eq/unsharp).
//
// Tum hareketler 2x ara olcekte hesaplanir (alt-piksel titreme olmasin).
"use strict";

const W = 1080, H = 1920;
const VIDEO_FG_HEIGHT = 1150;         // yatay klibin ekrandaki yuksekligi (~%60)
const PAN_SPAN = 0.42;                // yatay fotografta tasan genisligin kayilan payi

const ARSIV_TON = "eq=contrast=1.12:brightness=0.015:saturation=1.04,unsharp=5:5:0.55:5:5:0";
const DOKU = "noise=alls=6:allf=t+u,vignette=angle=PI/4.5";

function oran(w, h) { return w > 0 && h > 0 ? w / h : W / H; }

// Fotograf: [0:v] -> [v] (1080x1920, tam ekran). j = cekim sirasi (yon degisir), n = kare sayisi.
function fotoFiltre({ w, h, j = 0, n = 30, ton = "" }) {
  const ar = oran(w, h);
  const N = Math.max(1, n - 1);
  let hareket;
  if (ar > (W / H) * 1.25) {
    // Yatay ya da kare: 2x yukseklige olcekle, 9:16 pencereyi yatayda kaydir (tasan
    // genislik en az pencerenin %25'i, yoksa hareket fark edilmez). Yon sirayla degisir.
    const a = j % 2 === 0 ? 0.5 - PAN_SPAN / 2 : 0.5 + PAN_SPAN / 2;
    const b = j % 2 === 0 ? 0.5 + PAN_SPAN / 2 : 0.5 - PAN_SPAN / 2;
    hareket = `scale=-2:${H * 2},crop=${W * 2}:${H * 2}:x='(iw-ow)*(${a.toFixed(3)}${b >= a ? "+" : "-"}${Math.abs(b - a).toFixed(3)}*n/${N})':y=0,scale=${W}:${H}`;
  } else {
    // Dikeye yakin: ekrani kaplayacak kadar buyut, yavas yakinlas/uzaklas.
    const z = j % 2 === 0 ? `1+0.10*on/${N}` : `1.10-0.10*on/${N}`;
    hareket = `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},` +
      `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=30`;
  }
  return `[0:v]${hareket},setsar=1,${ARSIV_TON},${ton ? ton + "," : ""}${DOKU},fps=30,format=yuv420p[v]`;
}

// Video: [0:v] -> taban zinciri; ardindan kamera hareketi (punch/push/drift) eklenebilir.
// Donen deger son etiketi ACIK birakir (eski "taban" ile ayni sozlesme).
function videoTaban({ w, h, ton = "" }) {
  const ar = oran(w, h);
  const son = `${ton ? ton + "," : ""}${DOKU},fps=30,format=yuv420p`;
  if (ar <= 0.6) {
    return `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,${son}`;
  }
  return `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=26:2,eq=brightness=-0.20:contrast=1.05[bg];` +
    `[0:v]scale=-2:${VIDEO_FG_HEIGHT},crop='min(iw,${W})':${VIDEO_FG_HEIGHT},setsar=1[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,${son}`;
}

// Kaynagin ekrandaki kaplama orani (0-1): kalite denetimi ve testler icin.
function kaplama({ w, h, foto }) {
  if (foto) return 1;
  const ar = oran(w, h);
  if (ar <= 0.6) return 1;
  return VIDEO_FG_HEIGHT / H;
}

module.exports = { W, H, VIDEO_FG_HEIGHT, PAN_SPAN, ARSIV_TON, fotoFiltre, videoTaban, kaplama };
