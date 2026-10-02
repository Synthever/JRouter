---
version: alpha
name: JRouter
description: "Pedoman frontend monokrom dari /landing, dengan fondasi dark dan light mode."
colors:
  primary: "#FFFFFF"
  bg: "#0A0A0B"
  bg-2: "#0D0D0F"
  surface: "#131315"
  surface-2: "#1A1A1D"
  surface-inset: "#101012"
  surface-hover: "#232327"
  text: "#EDEDEE"
  text-2: "#A1A1A6"
  text-3: "#6B6B70"
  line: "rgba(255, 255, 255, 0.065)"
  line-2: "rgba(255, 255, 255, 0.11)"
  accent-line: "rgba(255, 255, 255, 0.18)"
  pos: "#34D39A"
  warn: "#F2B34B"
  danger: "#FF6B6B"
  light-bg: "#F7F7F8"
  light-bg-2: "#EFEFEF"
  light-surface: "#FFFFFF"
  light-surface-2: "#F0F0F2"
  light-surface-inset: "#EAEAEC"
  light-surface-hover: "#E4E4E7"
  light-text: "#0A0A0B"
  light-text-2: "#52525B"
  light-text-3: "#71717A"
  light-line: "rgba(0, 0, 0, 0.08)"
  light-line-2: "rgba(0, 0, 0, 0.14)"
  light-accent-line: "rgba(0, 0, 0, 0.22)"
  light-pos: "#15803D"
  light-warn: "#B45309"
  light-danger: "#DC2626"
typography:
  display:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.333333
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.428571
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.625
  label:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.2em"
rounded:
  r1: "6px"
  r2: "10px"
  r3: "14px"
  r4: "20px"
  full: "999px"
spacing:
  icon-gap: "8px"
  control: "12px"
  grid: "16px"
  panel: "20px"
  gutter: "24px"
  group: "32px"
  section-header: "48px"
  section: "64px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.bg}"
    rounded: "{rounded.r1}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.text}"
    textColor: "{colors.bg}"
    rounded: "{rounded.r1}"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.r1}"
    padding: "7px 14px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.text}"
    rounded: "{rounded.r1}"
  # Target light mode; inverse CTA belum diterapkan di Button / .ui-btn.
  light-button-primary:
    backgroundColor: "{colors.light-text}"
    textColor: "{colors.light-surface}"
    rounded: "{rounded.r1}"
    padding: "8px 16px"
  light-button-primary-hover:
    backgroundColor: "{colors.light-text-2}"
    textColor: "{colors.light-surface}"
    rounded: "{rounded.r1}"
  light-button-secondary:
    backgroundColor: "{colors.light-surface-2}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.r1}"
    padding: "7px 14px"
  light-button-secondary-hover:
    backgroundColor: "{colors.light-surface-hover}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.r1}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.r3}"
    padding: "20px"
  light-panel:
    backgroundColor: "{colors.light-surface}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.r3}"
    padding: "20px"
  input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.r1}"
    padding: "8px 12px"
  light-input:
    backgroundColor: "{colors.light-surface-2}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.r1}"
    padding: "8px 12px"
---

# Design System: JRouter

## Overview

Pedoman ini mengambil bahasa visual `/landing` sebagai fondasi frontend JRouter: monokrom, tipografi teknis, panel berlapis, dan kontrol yang ringkas. Halaman lain mempertahankan identitas tersebut sambil menyesuaikan layout dengan tugas pengguna, seperti mengelola provider, membaca usage, atau mengubah settings.

**Cakupan:** dark dan light mode, token visual, pola komponen, responsive, motion, dan kriteria penerimaan. Dokumen ini tidak mengubah kode, menetapkan ulang fitur produk, atau mewajibkan layout marketing pada dashboard.

### Status dan sumber acuan

- **Teramati:** tersedia dalam kode yang ditinjau pada 2 Oktober 2026. Fondasi light mode sudah ada, tetapi `/landing` sendiri memaksa `.dark`.
- **Target:** rekomendasi untuk halaman baru atau penyelarasan berikutnya. Target bukan klaim bahwa semua halaman sudah mengimplementasikannya.
- **Legacy:** gaya kompatibilitas yang masih dipakai sebagian kode, bukan arah visual utama.

Frontmatter memuat nilai acuan desain. Warna tanpa awalan adalah dark mode; `light-*` adalah pasangan light mode. Prefiks tersebut hanya nama dokumentasi, **bukan CSS variable baru**. Komponen `light-button-primary` dan hover-nya adalah **target** inverse CTA; token warna dasarnya sudah tersedia. Rincian batas implementasi dijelaskan di Components.

| Sumber | Kegunaan |
| --- | --- |
| [`src/app/landing/page.js`](../src/app/landing/page.js) dan [`components/`](../src/app/landing/components/) | Komposisi landing, glass, tipografi, dan motion aktual |
| [`src/app/globals.css`](../src/app/globals.css) | Token tema, radius, shadow, `.lp-*`, `.ui-*`, serta dashboard chrome |
| [`src/app/layout.js`](../src/app/layout.js) | Font Geist / Geist Mono dan inisialisasi tema sebelum paint |
| [`src/shared/components/`](../src/shared/components/) | Kontrol reusable dan variasi perilakunya |
| [`src/store/themeStore.js`](../src/store/themeStore.js), [`ThemeProvider`](../src/shared/components/ThemeProvider.js) | Preferensi `light`, `dark`, dan `system` |
| [`Spesifikasi dashboard 30 September`](superpowers/specs/2026-09-30-design-system-dashboard-shell-design.md) | Konteks historis; bukan sumber nilai terbaru |

CSS dan komponen adalah sumber implementasi; dokumen ini adalah pedoman lintas halaman. Jika ditemukan perbedaan, catat apakah kode belum mengikuti target atau dokumentasi perlu diperbarui. Jangan mengubah kode hanya untuk menutup perbedaan tanpa scope pekerjaan yang jelas.

### Prinsip bersama

1. **Monokrom untuk struktur.** Gunakan tingkat surface, kontras teks, dan whitespace untuk hierarki; warna berfungsi sebagai status.
2. **Teknis, tetapi terbaca.** Sans untuk navigasi dan isi; mono untuk kode, endpoint, label pendek, dan angka telemetry.
3. **Glass untuk lapisan, bukan setiap elemen.** Panel luar boleh transparan; kontrol, data, dan isi bertingkat tetap memiliki latar yang terbaca.
4. **Identitas sama, kepadatan berbeda.** Landing menjelaskan produk; dashboard membantu menyelesaikan tugas. Hero, shader, dan typewriter tidak menjadi template halaman operasional.
5. **Kedua tema memiliki hierarki yang setara.** Light mode menggunakan canvas terang dan teks gelap, bukan filter invert atas dark mode.

## Colors

### Pemetaan token semantik

Nilai ini berasal dari `:root` (light) dan `.dark` dalam `globals.css`.

| CSS variable | Dark | Light | Peran |
| --- | --- | --- | --- |
| `--bg` | `#0A0A0B` | `#F7F7F8` | Canvas halaman |
| `--bg-2` | `#0D0D0F` | `#EFEFEF` | Canvas sekunder |
| `--surface` | `#131315` | `#FFFFFF` | Panel, card, modal |
| `--surface-2` | `#1A1A1D` | `#F0F0F2` | Kontrol dan kelompok sekunder |
| `--surface-inset` | `#101012` | `#EAEAEC` | Code well dan area recessed |
| `--surface-hover` | `#232327` | `#E4E4E7` | Respons hover |
| `--text` | `#EDEDEE` | `#0A0A0B` | Isi dan judul utama |
| `--text-2` | `#A1A1A6` | `#52525B` | Deskripsi dan label sekunder |
| `--text-3` | `#6B6B70` | `#71717A` | Informasi tersier; periksa kontras |
| `--line` | putih 6.5% | hitam 8% | Hairline dan pemisah dekoratif |
| `--line-2` | putih 11% | hitam 14% | Perimeter kontrol / panel kuat |
| `--accent-line` | putih 18% | hitam 22% | Border hover / focus yang tersedia |
| `--pos` | `#34D39A` | `#15803D` | Success |
| `--warn` | `#F2B34B` | `#B45309` | Warning |
| `--danger` | `#FF6B6B` | `#DC2626` | Error / destructive |

Gunakan `var(--surface)`, `var(--text)`, atau alias Tailwind semantik seperti `bg-surface`, `text-text-main`, dan `text-text-muted`. Hindari pasangan hardcoded `bg-black` / `text-white` pada halaman yang mengikuti theme pengguna.

Perhatikan alias: `--color-text-muted` menunjuk `--text-2`, sedangkan `--text-muted` berbeda pada light mode. Gunakan peran yang jelas dan jangan menyamakan dua nama tersebut. Nama inset yang diterapkan adalah `--surface-inset`, bukan `--inset` dalam spesifikasi lama.

### Light mode

**Teramati:** token terang, panel opaque putih, dan shadow light sudah tersedia. Theme store mengubah class `.dark` pada root; halaman biasa tidak perlu mengelola tema sendiri. `/landing` belum mengikuti pilihan tersebut karena wrapper-nya selalu `.dark`.

**Target:** light mode mempertahankan radius, typography, spacing, dan struktur yang sama. Gunakan canvas `--bg`, panel `--surface`, kontrol `--surface-2`, dan teks `--text`. CTA utama memakai latar gelap dengan teks putih; secondary memakai surface netral dengan teks gelap. Logo dan ikon harus tetap terbaca tanpa membalik seluruh halaman.

### Warna khusus landing dan legacy

- Hero memakai putih murni serta utility `neutral-300` / `neutral-400`; jangan menganggap semua teksnya memakai token semantik.
- Shader aktif menggunakan `#949494`, `#595959`, `#343434` dengan grain aktif; fallback CSS menggunakan gradient netral gelap. Ini efek marketing, bukan warna status. Nilai ini mengikuti kode lokal saat dokumentasi diselesaikan, termasuk perubahan paralel shader.
- Traffic lights terminal memakai `#FF5F56`, `#FFBD2E`, `#27C93F`. Titik tersebut bukan pemetaan success/warning/error aplikasi.
- Coral `--color-primary: #E56A4A` masih dipakai legacy, selection, dan beberapa focus treatment. `--promo` merah juga tersedia. Jangan menghapusnya dalam pekerjaan dokumentasi, tetapi jangan menjadikan coral atau promo sebagai aksen default halaman baru yang mengikuti landing.
- Nama `colors.primary` pada frontmatter berarti permukaan CTA putih dark mode, **bukan alias** `--color-primary` yang masih coral.

### Batas kontras

Perhitungan berikut menggunakan warna solid, bukan screenshot atau komposit glass. Target teks biasa adalah WCAG AA minimal **4.5:1**, teks besar **3:1**, dan indikator kontrol/focus yang relevan **3:1** terhadap warna di sekitarnya.

| Pasangan solid | Rasio | Keputusan |
| --- | --- | --- |
| Dark `--text` pada `--bg` | 16.91:1 | Layak untuk isi |
| Dark `--text-2` pada `--surface` | 7.21:1 | Layak untuk teks sekunder |
| Dark `--text-3` pada `--surface` | 3.50:1 | Tidak untuk teks kecil penting |
| Light `--text` pada `--bg` | 18.48:1 | Layak untuk isi |
| Light `--text-2` pada `--surface` | 7.73:1 | Layak untuk teks sekunder |
| Light `--text-3` pada `--surface-2` | 4.25:1 | Tidak untuk teks kecil penting |
| Putih pada light `--surface-hover` | 1.27:1 | Hindari; masalah hover `.ui-btn--soft` saat ini |
| Putih dan `#0A0A0B`, kedua arah | 19.79:1 | Acuan CTA inverse |

Gunakan `--text-2` untuk hint atau metadata penting jika `--text-3` tidak memenuhi kontras. Hairline dekoratif bukan pengganti focus ring yang terlihat. Status solid pada `--surface` memenuhi 4.5:1 untuk kedua tema, tetapi badge berwarna dan panel transparan tetap perlu pengukuran kompositnya sendiri. Jangan menyatakan seluruh UI sudah lolos aksesibilitas berdasarkan token ini saja.

## Typography

**Font:** Geist untuk heading, body, navigasi, dan tombol; Geist Mono untuk label teknis, kode, endpoint, serta telemetry. Font dimuat lewat `next/font/google`; pertahankan `--font-sans` dan `--font-mono` beserta fallback yang ada.

| Peran | Nilai teramati | Penggunaan |
| --- | --- | --- |
| Hero display | 36 / 60 / 72px pada base / `sm` / `md`; weight 600; line-height 1.12; tracking -0.025em | Hero landing saja |
| Section heading | 24 / 30px; weight 600; tracking tight | Judul section; jangan otomatis memakai ukuran hero di dashboard |
| CTA heading | 24 / 30 / 36px | Penutup landing |
| Feature title | 14px / 600 | Card ringkas |
| Architecture title | 16px / 600 | Card penjelasan |
| Card title utility | 17px / 600; line-height 1.25; tracking -0.015em | `.ui-card__title`; bukan ukuran yang dipakai semua `Card` |
| Body section | 14px; line-height 1.625 | Deskripsi dan isi biasa |
| Hero description | 16 / 18 / 20px; weight 300; line-height 1.625 | Isi marketing dengan lebar maksimal 672px |
| Card detail | 12px; line-height 1.625 | Deskripsi singkat, bukan default paragraf panjang |
| Eyebrow | Mono 11px / 500; line-height 1.2; tracking 0.2em; uppercase | `.lp-eyebrow` / `.ui-eyebrow` |

**Target halaman operasional:** gunakan body 14px atau lebih besar untuk isi penting; 12px dibatasi pada metadata pendek. Input mobile minimal 16px untuk menghindari auto-zoom iOS. Uppercase digunakan untuk label singkat, bukan paragraf atau nama model panjang.

Gunakan `.u-tnum` untuk token count, latency, quota, biaya, dan angka yang berubah. Utility tersebut mengaktifkan tabular numbers; font mono tetap dipilih secara terpisah jika diperlukan. Heading mengikuti struktur semantik halaman, bukan dipilih berdasarkan ukuran visual saja.

## Layout

### Container dan spacing

| Acuan | Nilai teramati |
| --- | --- |
| `.lp-wrap` | Max-width 1120px, centered, padding horizontal 24px |
| `.page` | Max-width 1180px, centered, width 100%; padding ditangani shell |
| `.lp-section` | Padding vertikal 64px, tanpa border section |
| Hero | Min-height 92vh, padding atas 128px / bawah 80px, horizontal 16 / 24px |
| Grid features | Gap 16px, padding card 20px |
| Card architecture | Gap 24px, padding card 24px |
| Quickstart split | Gap 48px |
| Dashboard page padding | 24px, naik ke 32px pada `lg` melalui shell |

Spacing frontmatter merangkum nilai yang sudah dipakai, bukan menambahkan runtime scale baru. Gunakan jarak kecil untuk hubungan di dalam kontrol, jarak sedang untuk kelompok, dan jarak besar untuk section. Halaman operasional tidak membutuhkan padding 64px pada setiap panel.

### Responsive

Tailwind menggunakan `sm: 640px`, `md: 768px`, dan `lg: 1024px` pada pola landing berikut:

- Features: 1 kolom, 2 pada `sm`, 4 pada `lg`.
- Architecture: 1 kolom, 3 pada `md`.
- Quickstart: stacked, lalu dua kolom pada `lg`.
- Navigasi: menu mobile di bawah `md`; shortcut dashboard muncul mulai `sm`.
- Tombol hero: vertikal lalu horizontal pada `sm`; CTA penutup juga menjadi full-width di mobile.
- Footer: 2 / 4 / 5 kolom dengan area brand span 2.

Dashboard memiliki breakpoint tersendiri sesuai data: `.grid-stats` memakai 5 kolom, lalu 3 pada maksimal 1050px, 2 pada 720px, dan 1 pada 420px. Split analytics menjadi satu kolom pada 860px. Jangan memaksakan grid landing pada semua halaman.

**Target:** tidak ada horizontal overflow di viewport 390px; teks panjang dan aksi dapat wrap. Tabel atau code block boleh memiliki scroll lokal yang terlihat. Jangan menyalin aturan landing yang menyembunyikan scrollbar secara global. Pertahankan target sentuh sekitar 44px untuk aksi utama mobile, meskipun kontrol desktop lebih padat.

## Elevation & Depth

Depth berasal dari lapisan netral, perimeter halus, catchlight atas, dan shadow. Landing menambahkan glass di atas shader. Halaman operasional menggunakan panel yang stabil agar data tidak bergantung pada background animasi.

### Shadow bersama

| Token | Dark | Light |
| --- | --- | --- |
| `--shadow-card` | `inset 0 1px 0 0 rgba(255,255,255,0.04), 0 24px 48px -34px rgba(0,0,0,0.85)` | `inset 0 1px 0 0 rgba(255,255,255,0.8), 0 2px 8px -2px rgba(0,0,0,0.08)` |
| `--shadow-pop` | `inset 0 1px 0 0 rgba(255,255,255,0.06), 0 30px 60px -30px rgba(0,0,0,0.90)` | `inset 0 1px 0 0 rgba(255,255,255,0.9), 0 12px 32px -8px rgba(0,0,0,0.12)` |

`--shadow-card` untuk panel; `--shadow-pop` untuk modal / lapisan mengambang. Light mode memakai bayangan lebih ringan, bukan shadow hitam dark mode yang disalin langsung.

### Panel glass versus panel solid

| Varian | Acuan | Batas penggunaan |
| --- | --- | --- |
| Solid shared | `--surface`, border 1px `--line`, radius `--r3`, `--shadow-card` | Default form, konfigurasi, tabel, dan data padat di kedua tema |
| Glass landing dark | Hitam 30%, hover 40%, `backdrop-blur-xl`, tanpa border, shadow hitam 80% | Card marketing di atas background landing |
| Glass overview | Override lokal `.dashboard-overview`, bukan perilaku global `Card` | Pengecualian overview; baca CSS terkini sebelum menyalinnya |
| Light marketing | **Target:** mulai dari panel opaque `--surface`; transparansi opsional setelah kontras diverifikasi | Tidak ada implementasi light landing untuk dijadikan bukti visual |

Glass landing dan glass overview bukan komponen varian bernama yang sudah disediakan oleh `Card`. Jangan menganggap prop `elev` menyediakan variasi tersebut; prop itu diterima tetapi tidak dipakai dalam styling `Card` saat ini.

**Target fallback:** jika blur tidak tersedia atau pengguna memilih reduced transparency, panel memakai `--surface` opaque. Hindari blur bertingkat pada setiap card, inset, dan kontrol sekaligus. Shader tidak menjadi dependency untuk isi atau keterbacaan halaman.

## Shapes

| Token | Ukuran | Peran |
| --- | --- | --- |
| `--r1` | 6px | Button, input, item navigasi |
| `--r2` | 10px | Blok di dalam panel dan kelompok nested |
| `--r3` | 14px | Card / panel |
| `--r4` | 20px | Modal |
| `--r-full` | 999px | Pill badge dan navigasi landing saat scrolled |

Gunakan scale yang sama pada kedua tema. Pills bukan bentuk default semua tombol. Landing masih memiliki utility radius 8px / 16px pada elemen tertentu; itu pengecualian lokal, bukan tambahan wajib pada scale bersama.

Panel solid memakai hairline 1px; glass landing boleh tanpa border. Divider menjelaskan kelompok data, bukan dekorasi yang harus muncul di setiap section.

## Components

### Pemetaan implementasi

Gunakan komponen dari [`src/shared/components/`](../src/shared/components/) sebelum membuat padanannya sendiri. Hero dan card landing masih memiliki JSX styling lokal; dokumentasi ini tidak menyatakan semuanya sudah direfaktor menjadi library.

| Komponen | API / pola yang tersedia |
| --- | --- |
| [`Button`](../src/shared/components/Button.js) | `variant`: primary, secondary, outline, ghost, danger, success; `size`: sm, md, lg; `loading`, `disabled`, `fullWidth`, `icon`, `iconRight` |
| [`Card`](../src/shared/components/Card.js) | `title`, `subtitle`, `icon`, `action`, `padding`, `hover`; `Section`, `Row`, `ListItem` |
| [`Input`](../src/shared/components/Input.js) | `label`, `hint`, `error`, `icon`, `disabled`, serta native input props |
| [`Modal`](../src/shared/components/Modal.js) | `isOpen`, `onClose`, `title`, `footer`, `size`, `closeOnOverlay`; `ConfirmModal` |
| [`Icon`](../src/shared/components/Icon.js) | Wrapper Lucide SVG dengan pemetaan nama lama |
| [`AppLogo`](../src/shared/components/AppLogo.js) | Asset logo bersama `/brand/jrouter.svg` |
| [`DashboardLayout`](../src/shared/components/layouts/DashboardLayout.js) | Shell aplikasi dan constraint `.page` |

### Buttons

- **Teramati:** primary putih / teks gelap, secondary surface netral, radius 6px. Shared `Button` memiliki transisi 150ms, press scale 0.97, serta loading yang menonaktifkan tombol.
- Size shared: `sm` tinggi 28px; `md` 34px; `lg` 40px. Nilai padding frontmatter berasal dari `.ui-btn`; size API `Button` memiliki padding sendiri. Hero lebih lapang dengan padding 12px × 24px.
- **Target light primary:** latar `--text`, teks `--surface`; hover `--text-2` dengan teks putih. Ini belum diterapkan di shared `Button` maupun `.ui-btn--primary`.
- **Teramati:** `Button` secondary mempertahankan teks semantik pada hover. `.ui-btn--soft:hover` memaksakan putih dan tidak aman di light mode; targetnya tetap memakai `--text`.
- **Teramati:** varian `Button` danger / success masih memakai warna fixed-dark. Reuse komponen tidak berarti semua variannya sudah mengikuti tema; target penyelarasan memakai peran status tema dan background yang kontrasnya terukur.
- **Target:** focus-visible jelas, aksi destructive memakai label eksplisit, loading memiliki nama/status yang dapat dibaca assistive technology. Jangan membuat secondary menyaingi CTA utama.

### Cards dan data

- Default shared `Card`: surface solid, hairline, radius 14px, shadow-card; padding `md` adalah 20px lalu 24px pada `sm`.
- Panel glass mengikuti batas di Elevation & Depth; jangan mengganti seluruh card global agar satu halaman mengikuti landing.
- **Target data:** header memiliki judul dan aksi terkait, angka menggunakan tabular numbers, overflow ditangani lokal. Hover interaktif hanya untuk elemen yang benar-benar dapat diaktifkan.
- `Card.ListItem` saat ini menampilkan aksi pada hover; target aksesibilitas menuntut aksi juga tersedia saat keyboard focus dan pada touch.

### Inputs dan feedback

- Input memakai `--surface-2`, border `--line-2`, radius 6px, padding 8px × 12px; focus tersedia melalui border/ring `--accent-line`.
- Error memakai `--danger`, ikon, dan teks; hint memakai mono. **Target:** label terhubung melalui `htmlFor` / `id`, hint/error melalui `aria-describedby`, dan error melalui `aria-invalid`. Rendering label saat ini tidak menjamin hubungan tersebut.
- Default, hover, focus, disabled, loading, error, success, dan empty state harus memiliki tampilan yang jelas jika relevan. Disabled bukan cara menyembunyikan informasi penting.
- Badge status memakai warna tema dengan label, bukan warna saja. `Badge` dan `.badge-*` belum sepenuhnya seragam; latar status fixed-dark tidak otomatis menjadi standar light mode.

### Navigation dan dialogs

- Landing navigation fixed dan transparan, berubah menjadi glass pill setelah scroll 24px; max-width berubah dari 1280px menjadi 896px. Ini pola marketing, bukan pengganti sidebar dashboard.
- **Target aplikasi:** pertahankan shell dan active state semantik; light/dark memakai token yang sama. Menu mobile memiliki `aria-expanded`, nama aksi, dan interaksi keyboard.
- Modal memakai radius 20px, `--surface`, border `--line-2`, dan `--shadow-pop`. Escape serta body scroll lock sudah tersedia.
- **Target modal:** dialog semantics, label judul, focus trap, focus return, dan tombol close yang dapat diakses di semua ukuran. Perilaku tersebut belum dijamin komponen sekarang; traffic lights bukan pengganti kontrol close yang memadai.

### Icons dan assets

Gunakan `Icon` / Lucide dengan default stroke 2; ukuran landing yang umum 14px untuk indikator link, 18px untuk aksi, 20px untuk feature, dan 24px untuk architecture. Ikon dekoratif disembunyikan dari pembaca layar; icon-only action memiliki accessible name.

Gunakan `AppLogo` dan asset bersama; periksa kontras logo pada light mode. Nama produk yang menjadi patokan adalah JRouter. Metadata root masih menggunakan 9Router dan judul internal SVG masih memiliki branding lama; itu drift implementasi, bukan pilihan brand baru. Jangan membuat ulang logo atau provider marks dalam pekerjaan penyelarasan biasa.

### Motion

| Pola teramati | Nilai |
| --- | --- |
| Reveal umum | `cubic-bezier(0.16, 1, 0.3, 1)`, sekitar 700–900ms, opacity + translation |
| Feature stagger | 70ms per item |
| Navigasi pill | 300ms |
| Micro-interaction kontrol | Sekitar 150ms |
| Typewriter hero | Ketik 42ms, hapus 18ms, hold 2000ms, jeda kosong 280ms |
| Shader | Animasi kontinu, `uSpeed=0.3`, pixel density maksimal 2 |

**Target:** micro-interaction pendek untuk dashboard; reveal panjang, typewriter, watermark, dan shader terbatas pada marketing. Saat reduced motion, tampilkan teks statis dan konten langsung tanpa reveal atau animasi kontinu. Hindari layout shift dari judul yang berubah. Landing belum memiliki fallback reduced-motion lengkap untuk efek tersebut; aturan smooth-scroll saja tidak mencukupi.

## Do's and Don'ts

### Do

- **Do** gunakan token semantik agar layout yang sama bekerja pada kedua tema.
- **Do** pertahankan Geist / Geist Mono, radius scale, dan hierarki surface lintas halaman.
- **Do** pilih layout dari tugas pengguna dan bentuk data, bukan dari urutan section landing.
- **Do** ukur kontras pada latar hasil komposit jika memakai glass.
- **Do** pisahkan kondisi teramati, target, dan legacy ketika memperbarui pedoman ini.
- **Do** mask API key / token pada tampilan biasa; aksi reveal atau copy harus disengaja. Contoh dan screenshot dokumentasi tidak memuat credential nyata.

### Don't

- **Don't** memaksa `.dark` pada halaman operasional yang harus mengikuti theme pengguna.
- **Don't** menyalin shader, typewriter, scrollbar hiding, atau glass hitam ke semua halaman.
- **Don't** memakai putih pada hover surface terang, atau teks tersier berkontras rendah untuk informasi penting.
- **Don't** menambahkan warna dekoratif, blur nested, dan shadow baru ketika token bersama sudah cukup.
- **Don't** menganggap label clickable, card hover, atau titik traffic lights otomatis memiliki semantik kontrol yang benar.
- **Don't** mengulang klaim keamanan seperti “zero-leak” atau klaim performa landing sebagai fakta terverifikasi tanpa pemeriksaan terpisah.

### Checklist penerimaan halaman

- [ ] Dark dan light mempertahankan hierarki; CTA, hover, active, dan focus terbaca.
- [ ] Layout diperiksa minimal pada 390px, 768px, dan 1440px, termasuk string panjang.
- [ ] Tidak ada overflow halaman; scroll lokal tabel / code tetap dapat ditemukan.
- [ ] Default, loading, disabled, error, success, dan empty diperiksa jika relevan.
- [ ] Keyboard, accessible names, label form, serta focus dialog bekerja.
- [ ] Teks dan indikator penting memenuhi kontras pada background aktual.
- [ ] Reduced motion / transparency dan kegagalan background dekoratif tidak menyembunyikan isi.
- [ ] Credential dan contoh data sensitif tidak tampil tanpa kontrol yang sesuai.
- [ ] Perubahan tidak mengubah perilaku produk atau theme di luar scope.

### Dokumentasi pendamping

`DESIGN.md` cukup sebagai acuan visual awal. **Opsional:** `docs/FRONTEND.md` untuk cara menyusun route/layout, lokasi komponen, penggunaan theme, dan prosedur verifikasi. Simpan nilai visual hanya di sini dan referensikan dari dokumen teknis agar tidak ada dua sumber token. Dokumentasi brand terpisah, token export, atau component playground baru diperlukan ketika ada kebutuhan konkret; semuanya di luar perubahan ini.
