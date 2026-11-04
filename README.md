# Tools Ngisi Suara — versi publik

Paket ini memisahkan frontend GitHub Pages dari backend Cloudflare Workers. Gemini API Key hanya disimpan sebagai Secret di Cloudflare, bukan di HTML.

## Isi paket

- `index.html` — frontend, mempertahankan fitur HTML asli.
- `worker.js` — proxy backend ke Gemini API.
- `wrangler.toml` — konfigurasi deployment Worker.

## 1. Deploy backend Cloudflare Workers

1. Login ke https://dash.cloudflare.com/ lalu buka **Workers & Pages**.
2. Buat Worker baru bernama `tools-ngisi-suara-api`.
3. Pilih **Edit code** dan ganti kode contoh dengan seluruh isi `worker.js`.
4. Buka **Settings → Variables and Secrets**.
5. Tambahkan variable bertipe **Secret**:
   - Name: `GEMINI_API_KEY`
   - Value: API Key Gemini milik admin.
6. Tambahkan variable biasa:
   - Name: `ALLOWED_ORIGIN`
   - Value: `https://USERNAME.github.io` (ganti USERNAME dengan username GitHub).
7. Deploy Worker dan salin URL, misalnya `https://tools-ngisi-suara-api.NAMA-AKUN.workers.dev`.

Alternatif CLI: di folder paket jalankan `npx wrangler deploy`, lalu `npx wrangler secret put GEMINI_API_KEY`. Pastikan `ALLOWED_ORIGIN` di `wrangler.toml` sudah diganti sebelum deploy.

## 2. Sambungkan frontend ke Worker

1. Buka `index.html`.
2. Cari baris:
   `const WORKER_API_BASE = 'https://GANTI-DENGAN-URL-WORKER.workers.dev';`
3. Ganti dengan URL Worker milikmu, tanpa garis miring di akhir.
4. Simpan.

## 3. Hosting frontend di GitHub Pages

1. Buat repository GitHub, misalnya `tools-ngisi-suara`.
2. Upload `index.html` ke root repository.
3. Buka **Settings → Pages**.
4. Pilih **Deploy from a branch**, branch `main`, folder `/ (root)`, lalu Save.
5. Buka URL GitHub Pages yang diberikan.

PENTING: `ALLOWED_ORIGIN` adalah origin saja, bukan URL path repository. Untuk project Pages, gunakan `https://USERNAME.github.io`, bukan `https://USERNAME.github.io/tools-ngisi-suara/`.

## 4. Tes backend

Buka `https://URL-WORKER/health`. Respons normal: `{"ok":true,"service":"tools-ngisi-suara-api"}`.

Lalu buka website GitHub Pages dan coba Refine Text atau generate audio.

## Keamanan dan batas penggunaan

- Jangan pernah memasukkan API Key Gemini ke `index.html`, repository GitHub, atau browser.
- Endpoint ini terbuka untuk publik tanpa login. CORS hanya membatasi pemanggilan browser dari origin lain; CORS bukan autentikasi dan bukan perlindungan terhadap bot/cURL.
- Tidak ada batas generate per pengguna di aplikasi ini, sesuai pilihan pemilik. Namun Gemini API tetap memiliki kuota, kebijakan, dan biaya sesuai project; Cloudflare Workers juga memiliki batas paket.
- Karena endpoint publik memakai satu API Key bersama, pemilik sebaiknya memantau penggunaan Gemini dan menyiapkan billing alert/budget. Jika terjadi penyalahgunaan, tambahkan Cloudflare WAF Rate Limiting atau Turnstile sebelum membagikan link secara luas.
- Worker membatasi model ke dua model Gemini terbaru yang dipakai aplikasi dan ukuran request maksimal 25 MB.
- Aplikasi menggunakan `gemini-3.8-flash` untuk pemrosesan teks/transkripsi dan `gemini-3.8-flash-tts` untuk pembuatan suara. Model diperbarui dari preview lama pada HTML sumber agar sesuai dengan model yang tercantum di dokumentasi Gemini saat ini.

## Fitur yang dipertahankan

Mode Single, Mode Dialog, 20 preset suara, 21 tone, kecepatan, Refine Text, Voice to Text, Voice to Voice, rekaman mikrofon, riwayat audio, pemutar audio, download WAV, hapus riwayat, dan dark mode.
