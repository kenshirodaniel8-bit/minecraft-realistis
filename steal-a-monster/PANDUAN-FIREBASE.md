# Panduan: main online bareng teman dengan Firebase

Panduan ini membuat tombol **🌐 Play online with friends** di game kamu
(https://kenshirodaniel8-bit.github.io/minecraft-realistis/) bisa dipakai.
Kamu cukup melakukannya **satu kali**. Gratis, tanpa kartu kredit.

## Cara kerjanya (singkat)

- Satu pemain menekan **Create room**. Browser dia menjalankan "server" game,
  sama seperti waktu main sendiri.
- Dia mengirim **link room** (atau kode 5 huruf, misalnya `K7QZP`) ke teman.
- Teman membuka link lalu menekan **Join**. Semua pesan game (gerak, serang,
  rekrut, curi, dan lain-lain) lewat **Firebase Realtime Database**, sebuah
  database online gratis milik Google.
- Aturannya tetap sama: hanya game si pembuat room yang memutuskan uang,
  monster, dan pemiliknya. Teman cuma mengirim "aku bergerak / aku menyerang".

---

## Langkah 1: Buat project Firebase

1. Buka **https://console.firebase.google.com** lalu login dengan akun Google.
2. Klik **Create a project** (atau **Add project**).
3. Nama project: misalnya `steal-a-monster`, lalu klik **Continue**.
4. Google Analytics tidak perlu, jadi matikan saja. Klik **Create project**,
   tunggu sebentar, lalu klik **Continue**.

## Langkah 2: Buat Realtime Database

1. Di menu kiri pilih **Build → Realtime Database**.
2. Klik **Create Database**.
3. Lokasi: pilih **Singapore (asia-southeast1)**, yang paling dekat ke
   Indonesia sehingga lag-nya paling kecil. Klik **Next**.
4. Pilih **Start in locked mode**, lalu klik **Enable**.
5. Di bagian atas halaman data ada alamat database, contohnya
   `https://steal-a-monster-12345-default-rtdb.asia-southeast1.firebasedatabase.app`.
   Alamat ini dipakai di Langkah 4.

## Langkah 3: Pasang aturan keamanan (Rules)

1. Masih di Realtime Database, buka tab **Rules**.
2. Hapus semua tulisan yang ada.
3. Salin seluruh isi file
   [`firebase-database.rules.json`](firebase-database.rules.json) (ada di
   folder `steal-a-monster`), lalu tempel di sana.
4. Klik **Publish**.

Aturan ini hanya mengizinkan data room game (`sam/rooms/KODE`). Daftar room
tidak bisa dibaca, dan data lain di luar room tidak bisa ditulis.

## Langkah 4: Daftarkan aplikasi web dan salin config

1. Klik ikon **⚙ (gerigi)** di sebelah *Project Overview*, lalu pilih
   **Project settings**.
2. Di tab **General**, gulir ke bawah sampai bagian **Your apps**, lalu klik
   ikon **`</>`** (Web).
3. Nama aplikasi: misalnya `steal-a-monster-web`. Jangan centang *Firebase
   Hosting*. Klik **Register app**.
4. Akan muncul kode seperti ini. Salin bagian `{ ... }`-nya:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSyB...",
     authDomain: "steal-a-monster-12345.firebaseapp.com",
     databaseURL: "https://steal-a-monster-12345-default-rtdb.asia-southeast1.firebasedatabase.app",
     projectId: "steal-a-monster-12345",
     storageBucket: "steal-a-monster-12345.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef123456"
   };
   ```

5. **Penting:** pastikan ada baris `databaseURL`. Kalau tidak ada, tambahkan
   sendiri dengan alamat dari Langkah 2 nomor 5.

> `apiKey` Firebase **bukan rahasia**. Kunci ini memang selalu ada di halaman
> web, jadi aman ditaruh di GitHub. Yang menjaga database adalah Rules dari
> Langkah 3.

## Langkah 5: Tempel config ke game (lewat GitHub)

1. Buka **https://github.com/kenshirodaniel8-bit/minecraft-realistis**.
2. Di kiri atas, pilih branch **`claude/steal-a-monster-game-mjo51w`**. Itu
   branch yang dipakai untuk website game. Kalau nanti sudah di-merge ke
   `main`, edit di `main`.
3. Buka file **`steal-a-monster/public/firebase-config.js`**.
4. Klik ikon **✏ (Edit this file)**.
5. Ganti baris paling bawah

   ```js
   export const FIREBASE_CONFIG = null;
   ```

   dengan config kamu (perhatikan `export const FIREBASE_CONFIG =` di depan):

   ```js
   export const FIREBASE_CONFIG = {
     apiKey: "AIzaSyB...",
     authDomain: "steal-a-monster-12345.firebaseapp.com",
     databaseURL: "https://steal-a-monster-12345-default-rtdb.asia-southeast1.firebasedatabase.app",
     projectId: "steal-a-monster-12345",
     storageBucket: "steal-a-monster-12345.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef123456"
   };
   ```

6. Klik **Commit changes…**, lalu **Commit changes** lagi.
7. Buka tab **Actions**. Workflow **Publish Steal a Monster** akan berjalan
   sendiri (2–4 menit). Tunggu sampai tanda centangnya **hijau ✓**.

## Langkah 6: Main bareng!

1. Buka **https://kenshirodaniel8-bit.github.io/minecraft-realistis/**.
   Kalau sebelumnya sudah dibuka, tekan **Ctrl + F5** (atau tarik layar ke
   bawah di HP) supaya versi barunya termuat.
2. **Kamu (pembuat room):** isi nama, lalu tekan **Create room**.
3. Di atas layar muncul tombol **🌐 Room K7QZP · 1 player · 🔗 Copy link**.
   Tekan tombol itu supaya link tersalin, lalu kirim ke teman (WhatsApp,
   Discord, dll).
4. **Teman:** buka link itu, isi nama, lalu tekan **Join**. Kode room sudah
   terisi otomatis. Bisa juga dengan mengetik kode 5 hurufnya sendiri.
5. Satu room bisa diisi sampai **12 pemain** (ada 12 base).

---

## Hal penting yang perlu diketahui (jujur)

- **Browser pembuat room adalah servernya.** Kalau pembuat room menutup tab,
  internetnya putus, atau laptopnya tidur, room tertutup untuk semua orang dan
  teman akan melihat pesan *"The room was closed"*. Game dibuat supaya tetap
  jalan walaupun kamu pindah ke tab lain, tapi hal ini belum diuji di semua
  browser. Paling aman, biarkan tab game tetap terbuka di depan.
- **Progres teman disimpan di browser pembuat room.** Kalau teman main lagi
  di room yang dibuat **orang yang sama** (browser yang sama), monster dan
  uangnya kembali. Kalau orang lain yang membuat room, teman mulai dari awal
  di room itu. Progres main sendiri (single-player) tiap orang terpisah.
- **Lag:** semua pesan lewat server Firebase di Singapore. Biasanya ada jeda
  sekitar 100–300 ms. Masih enak dimainkan, tapi tidak secepat server game
  sendiri (`npm start` di komputer).
- **Kuota gratis (paket Spark):** 10 GB data per bulan dan 100 koneksi
  sekaligus. Satu teman menghabiskan sekitar **80 MB per jam** (diukur di
  pengujian), jadi kira-kira **100 jam main per bulan dengan 1 teman**, atau
  sekitar 40 jam dengan 3 teman. Pemakaiannya bisa dicek di
  **Realtime Database → Usage**. Kalau kuotanya habis, room tidak bisa dipakai
  sampai bulan berikutnya. Firebase tidak akan menagih uang selama kamu tetap
  di paket Spark.
- **Keamanan:** siapa pun yang tahu kode room bisa masuk. Kode berganti
  setiap kali kamu membuat room baru. Pembuat room bisa saja curang karena
  browsernya yang menjadi server, jadi mainlah dengan teman yang kamu percaya.

## Kalau ada masalah

| Yang terlihat | Penyebab dan solusi |
|---|---|
| *"Not set up yet…"* di bawah tombol online | Config belum masuk, atau websitenya belum diperbarui. Cek tab Actions sudah hijau, lalu tekan Ctrl + F5. |
| *"Room K7QZP was not found"* | Kodenya salah, atau pembuat room sudah menutup game-nya. Minta link baru. |
| *"Your friend has a different version"* | Salah satu masih memakai versi lama. Kalian berdua tekan Ctrl + F5. |
| *"Could not open an online room (… permission denied …)"* | Rules (Langkah 3) belum di-**Publish**, atau `databaseURL` di config salah. |
| Teman sering "tertarik balik" atau lag | Internet pembuat room kurang stabil. Pakai Wi-Fi, dan pastikan database di **Singapore**. |

---

## Untuk developer: menguji tanpa akun Firebase

Game ini sudah diuji dengan **Firebase Realtime Database Emulator** (versi
lokal resmi dari Google) dan Firebase SDK yang asli:

```bash
cd steal-a-monster
curl -o db-emu.jar https://storage.googleapis.com/firebase-preview-drop/emulator/firebase-database-emulator-v4.11.2.jar
java -jar db-emu.jar --port 9000 &
# (opsional) pakai Rules yang sama dengan Langkah 3:
curl -X PUT -H "Authorization: Bearer owner" --data-binary @firebase-database.rules.json "http://127.0.0.1:9000/.settings/rules.json?ns=demo-sam"
node scripts/build-web.mjs
node scripts/room-e2e.mjs 127.0.0.1:9000
```

Tes itu membuka dua browser: satu membuat room, satu lagi masuk lewat link,
lalu teman berjalan, bertarung, merekrut monster, dan pulang ke base. Di akhir
tes, pembuat room menutup game-nya. Semua kodenya ada di
`public/client/rooms.js`. Firebase SDK dibundel menjadi satu file
`public/vendor/firebase.js` (`node scripts/build-firebase.mjs`), jadi game
tidak bergantung pada CDN.
