# Frontend JRouter

Panduan teknis untuk mengerjakan halaman frontend tanpa membuat fondasi yang berbeda dari halaman lain. Ditinjau dari kode lokal pada **2 Oktober 2026**.

- [DESIGN.md](DESIGN.md): identitas visual, token kedua tema, komponen secara visual, dan checklist desain.
- Dokumen ini: lokasi kode, komposisi halaman, state, theme, i18n, akses API, serta verifikasi.
- [ARCHITECTURE.md](ARCHITECTURE.md): konteks gateway dan sistem; bukan panduan styling. Bagian persistence lama perlu dibandingkan dengan [CLAUDE.md](../CLAUDE.md).

Nilai warna, ukuran, radius, dan shadow tidak diduplikasi di sini. **Teramati** berarti perilaku kode saat ditinjau; **pedoman** berarti aturan untuk pekerjaan berikutnya, bukan jaminan semua halaman lama sudah mengikutinya. Dokumen ini tidak mengimplementasikan target light mode atau memperbaiki gap komponen yang dicatat di DESIGN.md.

## 1. Stack dan peta kode

| Area | Sumber | Tanggung jawab |
| --- | --- | --- |
| Framework dan scripts | [package.json](../package.json) | Next.js 16, React 19, Tailwind v4, Zustand; JavaScript ESM + JSX |
| Alias import | [jsconfig.json](../jsconfig.json) | `@/*` menunjuk `src/*`; bukan root repository |
| App Router | [src/app/](../src/app/) | `page.js`, `layout.js`, dan handler `api/*/route.js` |
| CSS global | [globals.css](../src/app/globals.css), [postcss.config.mjs](../postcss.config.mjs) | Token, theme, utilities, dan Tailwind melalui PostCSS |
| Komponen bersama | [src/shared/components/](../src/shared/components/) | Kontrol, feedback, navigasi, dan shell aplikasi |
| Hook dan utility | [hooks/](../src/shared/hooks/), [utils/](../src/shared/utils/) | Theme, clipboard, kelas, serta helper lain |
| Client state bersama | [src/store/](../src/store/) | Theme, notifications, search, settings, dan provider cache |
| i18n runtime | [src/i18n/](../src/i18n/), [public/i18n/literals/](../public/i18n/literals/) | Translasi literal antarmuka |
| Asset publik | [public/brand/](../public/brand/), [public/providers/](../public/providers/) | Logo aplikasi dan provider |
| Tes | [tests/unit/](../tests/unit/), [vitest.config.js](../tests/vitest.config.js) | Unit dan pemeriksaan kontrak sumber; environment Node |

`gitbook/` dan `cli/` memiliki paket terpisah. Jangan mengubah keduanya untuk menyelaraskan dashboard kecuali diminta. `open-sse/` adalah engine routing, bukan lokasi komponen UI; baca instruksinya jika pekerjaan memang menyentuh engine.

## 2. Route dan layout

### Komposisi aktual

1. [Root layout](../src/app/layout.js) menyediakan HTML/body, font, CSS global, theme sebelum paint, lalu `ThemeProvider` dan `RuntimeI18nProvider`.
2. [Layout `(dashboard)`](<../src/app/(dashboard)/layout.js>) membungkus anaknya dengan [DashboardLayout](../src/shared/components/layouts/DashboardLayout.js).
3. `DashboardLayout` menyediakan sidebar desktop/mobile, header, toast, dan area konten dengan scroll lokal.
4. `page.js` di dalam group cukup merender isi halaman; jangan membungkusnya lagi dengan shell yang sama.

Nama group `(dashboard)` tidak menjadi segmen URL. Contohnya `src/app/(dashboard)/dashboard/providers/page.js` menghasilkan `/dashboard/providers`.

| Route | Sumber | Catatan |
| --- | --- | --- |
| `/` | [app/page.js](../src/app/page.js) | Redirect ke `/dashboard`, bukan `/landing` |
| `/dashboard` | [dashboard/page.js](<../src/app/(dashboard)/dashboard/page.js>) | Server wrapper yang memasok props ke client overview |
| `/dashboard/providers` | [providers/page.js](<../src/app/(dashboard)/dashboard/providers/page.js>) | Halaman client dalam shell |
| `/dashboard/usage` | [usage/page.js](<../src/app/(dashboard)/dashboard/usage/page.js>) | Tab dari query string dan batas `Suspense` |
| `/landing` | [landing/page.js](../src/app/landing/page.js) | Komposisi marketing terpisah, tetap menerima root providers |
| `/login` | [login/page.js](../src/app/login/page.js) | Wrapper sendiri; tidak otomatis menggunakan `AuthLayout` |
| `/dashboard/settings/pricing` | [pricing/page.js](../src/app/dashboard/settings/pricing/page.js) | Berada di luar group `(dashboard)`; tidak mewarisi shell dashboard |

**Awalan URL tidak menentukan layout.** Periksa posisi file dan rantai `layout.js`, bukan hanya nama `/dashboard`.

### Scroll dan pengecualian shell

- Shell memakai tinggi viewport, sementara area konten menangani scroll vertikal. Jangan menambahkan scroll halaman kedua tanpa kebutuhan konkret.
- Halaman biasa mendapat padding shell dan wrapper `.page`. Isi halaman menambahkan grid atau kelompoknya sendiri, bukan padding shell duplikat.
- Exact `/dashboard/basic-chat` mendapat area full-height tanpa padding biasa atau `.page`.
- Exact `/dashboard` mendapat class background khusus; jangan menyalin pengecualian overview ke semua halaman.
- Header di-key dengan pathname sehingga remount saat route berubah. Cleanup state yang didaftarkan halaman tetap diperlukan.
- Collapse sidebar desktop disimpan dengan key `9router_sidebar_collapsed`; mobile memakai drawer. Shortcut Ctrl/Cmd+B mengabaikan input, textarea, dan contenteditable.

Shell bukan batas keamanan. [proxy.js](../src/proxy.js) dan [dashboardGuard.js](../src/dashboardGuard.js) menangani akses halaman/API; menyembunyikan tombol atau memasukkan halaman ke group bukan pengganti pemeriksaan server.

## 3. Batas server dan client

**Teramati:** root/group layout dan beberapa page wrapper adalah Server Component. Banyak halaman interaktif langsung memakai `"use client"`; overview memisahkan server wrapper dari [DashboardOverviewClient](<../src/app/(dashboard)/dashboard/DashboardOverviewClient.js>).

**Pedoman:**

- Biarkan wrapper menjadi server jika hanya menyusun komponen atau membaca data server yang memang diperlukan.
- Gunakan `"use client"` pada batas interaksi yang memerlukan state, effect, event, browser API, atau client store. Komponen client tetap dapat diprerender; jangan mengakses `window`, `document`, atau localStorage tanpa penanganan server-render yang aman.
- Jangan mengimpor DB, credential manager, `fs`, atau service server ke client bundle. Props dari server harus serializable dan hanya memuat data yang aman untuk browser.
- Untuk URL tab/filter, gunakan pola Next navigation yang sudah ada dan validasi nilai query. Pola usage membungkus pemakai `useSearchParams` dalam `Suspense`; jangan meniru daftar tabnya sebagai kontrak produk baru.
- Effect yang memasang timer, listener, observer, atau request perlu cleanup yang sesuai. Request yang sudah tidak relevan tidak boleh menimpa pilihan route/filter terbaru.
- Colocate bagian khusus halaman dalam `components/` di dekat route. Pindahkan ke shared hanya jika ada pemakaian bersama yang nyata.

## 4. Komponen dan styling

### Import dan reuse

[Barrel komponen](../src/shared/components/index.js) menyediakan named exports seperti `Button`, `Card`, `Input`, `Modal`, `ConfirmModal`, `PageLoading`, dan `SegmentedControl`. Import langsung seperti `@/shared/components/Button` juga digunakan. Ikuti gaya file yang sedang diedit; tidak perlu merombak semua import.

| Kebutuhan | Komponen / utility | Catatan teknis |
| --- | --- | --- |
| Aksi | [Button](../src/shared/components/Button.js) | `loading` menonaktifkan aksi; gunakan `type="button"` untuk tombol non-submit di dalam form |
| Panel | [Card](../src/shared/components/Card.js) | Slot title/action dan padding; periksa implementasi prop, bukan namanya saja |
| Input | [Input](../src/shared/components/Input.js) | Controlled value/change, hint/error; asosiasi label dan ARIA tetap harus diperiksa |
| Dialog | [Modal](../src/shared/components/Modal.js) | Controlled open/close, Escape, scroll lock; bukan portal dan belum menyediakan focus trap |
| Feedback loading | [Loading](../src/shared/components/Loading.js) | `Spinner`, `PageLoading`, `Skeleton`, `CardSkeleton` |
| Ikon | [Icon](../src/shared/components/Icon.js) | Nama legacy dipetakan ke Lucide; nama tak dikenal jatuh ke ikon fallback |
| Logo | [AppLogo](../src/shared/components/AppLogo.js) | Pakai asset bersama, jangan membuat logo halaman sendiri |
| Pilihan segmen | [SegmentedControl](../src/shared/components/SegmentedControl.js) | Kontrol shared yang tersedia |
| Highlight pilihan animasi | [AnimatedBackground](../src/components/core/animated-background.js) | Komponen terpisah berbasis `motion/react`; controlled `value` / `onValueChange`, child dengan `data-id`; jangan menganggap API-nya sama dengan `SegmentedControl` |
| Penggabungan kelas | [cn](../src/shared/utils/cn.js) | Menggabungkan string truthy dan whitespace; tidak menghapus duplikat atau menyelesaikan konflik utility Tailwind |

Reuse tidak otomatis menjamin seluruh variasi sudah mendukung light mode atau aksesibilitas. Baca batas implementasi dalam [DESIGN.md](DESIGN.md) sebelum memakai komponen sebagai template.

### Penempatan styling

- Gunakan utility Tailwind dan token semantik yang sudah ada. CSS global baru hanya untuk aturan yang benar-benar bersama.
- Beri scope pada pengecualian halaman agar tidak mengubah semua `Card`, input, atau navigasi. `.dashboard-overview` adalah contoh scope lokal, bukan perintah menjadikan semua panel glass.
- Jangan menumpuk kelas yang berkonflik dengan asumsi argumen terakhir `cn()` selalu menang; hasil akhir ditentukan CSS yang dihasilkan.
- Pertahankan font dan asset yang sudah dimuat root. Jangan menambah loader font/theme provider di setiap page.
- Untuk motion, dahulukan pola yang sudah digunakan. Background WebGL dan efek marketing bukan dependency data atau interaksi dashboard.

## 5. Theme: light, dark, system

### Alur aktual

| Sumber | Peran |
| --- | --- |
| [THEME_CONFIG](../src/shared/constants/config.js) | Default `system`, storage key `theme` |
| [Root layout](../src/app/layout.js) | Script sebelum paint membaca `JSON.state.theme` dari localStorage dan menerapkan `.dark` |
| [themeStore](../src/store/themeStore.js) | Zustand persistence; `setTheme`, `toggleTheme`, `initTheme`; `.dark` ditambah/dihapus pada root |
| [ThemeProvider](../src/shared/components/ThemeProvider.js) | Inisialisasi tema saat mount |
| [useTheme](../src/shared/hooks/useTheme.js) | `theme`, `setTheme`, `toggleTheme`, `isDark`; subscription perubahan preferensi OS |

**Pemakaian:** halaman mengikuti token CSS tanpa class `.dark` lokal. Jika komponen perlu memilih tema atau menyesuaikan perilaku, gunakan `useTheme`; jika hanya styling, token sudah cukup. `theme` adalah pilihan tersimpan, sedangkan `isDark` adalah resolusi efektifnya.

### Batas yang perlu diuji

- `toggleTheme()` bukan siklus tiga pilihan: `dark` menjadi `light`, nilai lain termasuk `system` menjadi `dark`. Untuk pilihan system gunakan `setTheme("system")`.
- Pembaruan OS secara langsung bergantung pada consumer `useTheme` yang mounted; `ThemeProvider` sendiri hanya menginisialisasi saat mount.
- Script sebelum paint bergantung pada key dan struktur persistence. Perubahan schema harus menyelaraskan script dan store, bukan salah satunya saja.
- Wrapper landing memaksa `.dark`; pilihan root light tidak menjadikan landing terang.
- Target CTA light dalam DESIGN.md belum berarti semua shared button sudah mengimplementasikannya.

Jangan memperbaiki mekanisme theme, mengubah storage key, atau memigrasikan landing sebagai efek samping pekerjaan dokumentasi atau styling satu halaman.

## 6. State, API, dan feedback

### Pilih state sesuai pemiliknya

- State lokal untuk input, dialog, pilihan sementara, dan loading milik halaman.
- Query string untuk pilihan yang memang perlu mengikuti URL/back-forward; pertahankan query lain ketika mengubah satu parameter.
- Store bersama untuk state yang digunakan lintas komponen atau cache yang sudah ada. [settingsStore](../src/store/settingsStore.js) dan [providerStore](../src/store/providerStore.js) memiliki mekanisme cache; jangan membuat fetch duplikat jika pemilik data tersebut sudah menyediakan kebutuhan yang sama.
- Settings mendukung invalidation/force refresh dan menggabungkan hasil PATCH ke cache. Setelah mutation, sinkronkan state pemilik data; jangan mengganti cache lengkap dengan response parsial tanpa memeriksa kontraknya.

### Request aktual dan pedoman error

Native same-origin `fetch("/api/...")` adalah pola umum. Tidak ada kewajiban memakai satu API client untuk semua page. [Helper api](../src/shared/utils/api.js) tersedia untuk GET/POST/PUT/DELETE JSON dan melempar error dengan `status` / `data`.

Helper tersebut mengasumsikan body JSON, tidak menyediakan retry atau redirect auth terpusat, dan opsi yang di-spread terakhir dapat mengganti header yang sebelumnya digabung. Jangan menggunakannya untuk SSE, file, atau response kosong tanpa meninjau kebutuhan. Jangan membuat abstraksi pengganti hanya karena pola halaman lain berbeda.

**Pedoman setiap operasi:**

1. Bedakan loading awal, refreshing, dan saving; hindari submit ganda.
2. Periksa status HTTP; kegagalan jaringan dan response non-OK bukan empty state.
3. Parse response sesuai kontrak dan tangani body tak valid tanpa menampilkan payload mentah.
4. Tampilkan pesan yang dapat ditindaklanjuti; reset loading dalam `finally` atau mekanisme setara.
5. Jangan menghapus input pengguna atau menampilkan sukses jika server belum menyatakan operasi berhasil.
6. Untuk fetch effect, pertimbangkan pembatalan/ignore stale result; retry hanya jika aman, terutama untuk mutation.

[Providers](<../src/app/(dashboard)/dashboard/providers/page.js>) menunjukkan parallel fetch dan loading; [Profile](<../src/app/(dashboard)/dashboard/profile/page.js>) menunjukkan mutation serta feedback inline. Itu contoh lokal, bukan bukti error handling semua halaman seragam.

### Feedback dan pencarian header

[notificationStore](../src/store/notificationStore.js) menyediakan feedback success/error/warning/info yang dirender oleh shell dashboard. Halaman standalone tidak otomatis memiliki toast renderer yang sama; pilih feedback yang benar-benar terlihat dalam layoutnya.

[headerSearchStore](../src/store/headerSearchStore.js) memungkinkan halaman mendaftarkan pencarian; providers melakukan registration pada mount dan unregistration pada cleanup. Jangan membiarkan konfigurasi pencarian halaman lama terbawa ke route berikutnya.

### Keamanan browser

- Akses DB dan credential dilakukan melalui server/API yang sudah ada, bukan import repositori DB ke client.
- Jangan menaruh key provider atau password dalam `NEXT_PUBLIC_*`, bundle, URL, localStorage baru, console log, atau contoh dokumentasi. Theme/collapse preference bukan tempat penyimpanan secret.
- Mask data sensitif; reveal/copy harus merupakan aksi sadar pengguna. Jangan menampilkan raw upstream error yang mungkin berisi credential.
- Pemeriksaan UI tidak menggantikan auth/authorization server. Tangani expired session tanpa melonggarkan guard.
- Jangan mencoba provider, shutdown, updater, import database, atau mutation konfigurasi sebagai uji visual biasa. Gunakan fixture aman atau lingkungan uji yang disepakati.

## 7. i18n runtime

**Teramati:** proyek memakai translasi literal DOM saat runtime, bukan locale-prefixed route atau hook `useTranslation` standar.

- [RuntimeI18nProvider](../src/i18n/RuntimeI18nProvider.js) menginisialisasi dan memproses ulang setelah pathname berubah.
- [runtime.js](../src/i18n/runtime.js) membaca cookie locale, memuat `/i18n/literals/<locale>.json`, lalu mengamati text node yang ditambah atau ditulis ulang.
- English atau literal yang tidak tersedia mempertahankan teks sumber.
- [LanguageSwitcher](../src/shared/components/LanguageSwitcher.js) memakai endpoint [locale](../src/app/api/locale/route.js) dan memuat ulang translasi tanpa navigasi halaman.
- `data-i18n-skip` mengecualikan subtree. Pakai untuk teks teknis/data yang tidak boleh diubah, bukan untuk menghindari translasi seluruh UI.

**Pedoman dan batas:**

- Gunakan source label yang konsisten; perubahan literal dapat memerlukan pembaruan map dalam `public/i18n/literals/`.
- Placeholder, tooltip attribute, dan accessible name tidak otomatis diterjemahkan oleh text-node walker. Untuk teks attribute yang perlu translasi, gunakan `translate()` dan mekanisme re-render locale seperti pola komponen yang sudah ada; jangan menganggap satu pemanggilan saat mount cukup.
- Root masih `lang="en"`; runtime belum menjamin pembaruan `lang` / direction. Itu gap implementasi, bukan dukungan RTL yang sudah selesai.
- Jangan mengubah API identifier, nama model, endpoint, atau isi code block demi bahasa tampilan.
- Uji label panjang dan re-render setelah perubahan bahasa, bukan hanya first paint. Periksa missing translation dan kegagalan pemuatan map.

## 8. Alur mengerjakan halaman

1. Tentukan route dan tugas pengguna; baca file target, layout induk, DESIGN.md, dan instruksi yang berlaku.
2. Catat batas perubahan serta kondisi awal git. Jangan menimpa perubahan user/agent lain.
3. Reuse shell dan komponen; pilih sumber state/API yang sudah menjadi pemilik data.
4. Terapkan layout dan token tanpa menyalin efek landing yang tidak diperlukan.
5. Tangani state relevan, theme, i18n, keyboard, data panjang, dan keamanan informasi.
6. Tambahkan tes kecil untuk logika non-trivial; lakukan verifikasi scoped dan dokumentasikan gap yang belum diimplementasikan.

**Scope frontend tidak otomatis mencakup backend, commit, push, atau deploy.** Jika hambatan berasal dari kontrak API, laporkan dan minta keputusan sebelum mengubah lapisan lain.

## 9. Verifikasi

Bagian ini adalah prosedur untuk pekerjaan berikutnya, **bukan laporan bahwa semua pemeriksaan sudah dijalankan**. Jalankan terhadap perubahan sendiri; jangan memakai `--fix` global atau mengubah execution policy untuk lolos tooling.

### Pemeriksaan statis dan tes

| Pemeriksaan | Lokasi / cara | Batas |
| --- | --- | --- |
| Whitespace diff | Dari root: `git diff --check` | Tidak memeriksa perilaku UI |
| ESLint scoped | Dari root: `npx.cmd eslint <file-js-yang-diubah>` pada PowerShell; `npx eslint` pada shell lain | Konfigurasi ada di `eslint.config.mjs`; Markdown bukan target ESLint JS |
| Tes unit scoped | Dari `tests/`: `npx.cmd vitest run unit/dashboard-navigation-style.test.js unit/dashboard-glass-style.test.js unit/dashboard-segmented-control.test.js` | Pilih file yang relevan; root dependency dan dependency tests harus tersedia |
| Build | Dari root: `npm.cmd run build` pada PowerShell, atau `npm run build` | Webpack build dan postbuild asset copy; jangan bersamaan dengan server yang memakai direktori build yang sama |
| Dokumen | Parse Markdown, periksa tautan lokal, dan diff | Tidak membutuhkan build aplikasi jika hanya dokumen yang berubah |

Tes adalah paket terpisah. [tests/package.json](../tests/package.json) saat ini memakai script Vitest tanpa path Unix khusus. Dari `tests/`, `npm.cmd test` menjalankan suite penuh; untuk pekerjaan frontend biasa gunakan Vitest scoped seperti tabel. Root tidak memiliki script `test`.

Environment Vitest saat ini **Node**, bukan browser E2E. Tes style/source-contract dan render statis tidak membuktikan focus, scroll, responsive, atau animasi browser bekerja.

Full suite memiliki kegagalan baseline dan sebagian tes membutuhkan resource/credential di luar checkout. Bila full suite memang diperlukan, baca [baseline verifier](../tests/__baseline__/verify-no-regression.mjs) dan [known-fails](../tests/__baseline__/known-fails.txt), pisahkan regresi baru dari kegagalan lama, dan jangan menganggap hasil gate otomatis portabel ke semua path Windows. Jangan menjalankan live-provider tests untuk perubahan frontend biasa.

### Server lokal

Scripts aktual ada di [package.json](../package.json): `npm.cmd run dev` untuk development atau `npm.cmd run dev:webpack` untuk webpack, dengan port default **20128**. Sebelum memulai, pastikan apakah instance sudah berjalan; jangan menyalakan instance kedua atau mematikan terminal user. Gunakan environment lokal yang sesuai, bukan data/credential produksi.

Production start memakai `custom-server.js`, bukan sekadar menyalakan server Next alternatif. Build/start bukan izin deploy. Jangan menghapus `.next`, database, atau state untuk mengatasi masalah UI tanpa scope dan persetujuan yang jelas.

### Pemeriksaan browser

- Periksa route melalui navigasi dan reload langsung, bukan hanya hot reload.
- Dark, light, dan system: pilihan, refresh persistence, hover/focus, serta perubahan OS jika hook yang sesuai mounted.
- Viewport sesuai checklist DESIGN.md: layout, sidebar/drawer, text wrapping, overflow, dan scroll lokal.
- Default, loading, empty, error, success, disabled, serta request lambat/stale bila relevan.
- Keyboard, label, fokus dialog, Escape, accessible names, dan target sentuh.
- Bahasa kedua dengan label panjang; translasi setelah navigasi atau state update.
- Reduced motion/transparency dan background dekoratif gagal tanpa kehilangan isi.
- Tidak ada secret pada screenshot, console, atau URL; jangan mengaktifkan tindakan berbahaya hanya untuk mengecek tampilannya.

Gunakan request interception atau fixture aman untuk mensimulasikan error bila tersedia. Catat ukuran viewport, tema, route, dan batas pemeriksaan; jangan menyebut source test sebagai bukti verifikasi visual.

### Laporan selesai

Sebutkan file yang diubah, perilaku yang berubah, pemeriksaan yang benar-benar dijalankan beserta hasilnya, dan blocker/gap yang tersisa. Bedakan perubahan dokumentasi dari implementasi frontend. Commit, push, dan deploy hanya dilakukan ketika diminta.