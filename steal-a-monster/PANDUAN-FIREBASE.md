# Panduan: main online bareng teman dengan Firebase

Panduan ini membuat tombol **🌐 Play online with friends** di game kamu
(https://kenshirodaniel8-bit.github.io/minecraft-realistis/) bisa dipakai.
Kamu cukup melakukannya **satu kali**. Gratis, tanpa kartu kredit.

> ### ⚡ Yang perlu kamu lakukan SEKARANG (versi dengan akun)
>
> Config Firebase kamu (`steal-a-monster`) **sudah terpasang** di game, jadi
> Langkah 4 dan 5 sudah selesai. Karena sekarang game memakai **akun**, masih
> ada 3 hal yang harus kamu lakukan sendiri di Firebase Console:
>
> 1. **Langkah 3** — tempel dan **Publish** aturan (Rules) yang **baru** dari
>    `firebase-database.rules.json`. Aturan lama tidak mengizinkan akun, jadi
>    tanpa ini login/simpan progres akan ditolak (*permission denied*).
> 2. **Langkah 3b** — nyalakan login **Email/Password** di *Authentication*.
> 3. **Langsung buat akun admin** di game: **Daniel**, **Nadine** (akun `naddd`), **Prabu**
>    dan **Shallom** (lihat bagian *Akun dan admin*). Siapa pun yang pertama
>    membuat akun dengan nama itu menjadi admin semua server, jadi jangan
>    sampai keduluan orang lain.
>
> Kalau sebelum ini kamu sudah mencoba *Create account* dan gagal, tidak
> apa-apa: setelah langkah 1 dan 2 selesai, coba **Create account** lagi
> dengan nama dan password yang sama.

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

Aturan ini mengatur:

- **Akun** (`sam/accounts/...`): hanya pemilik akun yang bisa menulis
  akunnya sendiri, dan nama di akun harus sama dengan nama yang dipakai
  untuk login (jadi tidak ada yang bisa menyamar jadi admin).
- **Ban dan pengembalian monster** (`sam/bans`, `sam/returns`): hanya akun
  admin (Daniel, Nadine, Prabu, Shallom) yang bisa menulisnya.
- **Room** (`sam/rooms/KODE`): harus login; pemain yang di-ban tidak bisa
  membuat atau masuk room; tidak ada yang bisa mengirim pesan atas nama orang
  lain; hanya pembuat room yang bisa menutupnya. Daftar room tidak bisa dibaca.

Kalau nanti file `firebase-database.rules.json` berubah lagi (misalnya setelah
update game), ulangi langkah ini supaya aturan di Firebase ikut baru.

## Langkah 3b: Nyalakan login akun (Authentication)

Akun pemain memakai **Firebase Authentication**. Pemain tidak perlu punya
email: game membuat "email" sendiri dari nama, misalnya nama `Mira Fox`
menjadi `mira.fox@players.steal-a-monster.game`. Pemain cukup mengisi **nama**
dan **password** (minimal 6 karakter).

1. Di menu kiri pilih **Build → Authentication**.
2. Klik **Get started**. **Wajib** kalau tombol ini muncul: tanpa ini semua
   pendaftaran ditolak (error `CONFIGURATION_NOT_FOUND`).
3. Buka tab **Sign-in method**.
4. Di daftar *Native providers* pilih **Email/Password**.
5. Nyalakan tombol **Enable** yang pertama (Email/Password). Yang kedua,
   *Email link (passwordless sign-in)*, **biarkan mati**.
6. Klik **Save**.

> **Jangan menambah pemain lewat tombol *Add user* di Firebase Console**
> (misalnya dengan email Gmail). Akun game dibuat **di dalam game** lewat
> **Create account** dengan nama game (misalnya `Daniel`). Di tab *Users*
> akun itu akan muncul sebagai `daniel@players.steal-a-monster.game`. User
> yang ditambah dengan email biasa bukan akun game dan tidak bisa dipakai
> login di game (boleh dihapus).

Selesai. Kalau langkah ini terlewat, pemain akan melihat tulisan
*"Accounts are not switched on yet…"* saat mencoba membuat akun.

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
2. **Kamu (pembuat room):** pilih **Create account** (pertama kali) atau
   **Log in**, isi nama dan password, lalu tekan **Create room**. Muncul
   pertanyaan *"start over from the beginning, or continue?"*: pilih
   **Continue** untuk melanjutkan progres, atau **Start over** untuk mulai
   dari nol (progres akun benar-benar dihapus).
3. Di atas layar muncul tombol **🌐 Room K7QZP · 1 player · 🔗 Copy link**.
   Tekan tombol itu supaya link tersalin, lalu kirim ke teman (WhatsApp,
   Discord, dll).
4. **Teman:** buka link itu, buat akun atau login, lalu tekan **Join**. Kode
   room sudah terisi otomatis. Bisa juga dengan mengetik kode 5 hurufnya
   sendiri.
5. Satu room bisa diisi sampai **12 pemain** (ada 12 base).

---

## Akun dan admin

- **Nama tidak boleh sama.** "Mira Fox", "mira fox" dan "Mira   Fox"
  dianggap nama yang sama. Spasi boleh. Nama 2–16 huruf/angka/spasi/`_`/`-`.
- **Monster ikut ke mana saja.** Progres (monster, uang, kostum, penjaga, dan
  lain-lain) disimpan di **akun masing-masing pemain** di Firebase. Monster
  yang kamu dapat di room teman tetap ada di game kamu sendiri dan di room
  lain. Progres disimpan otomatis kira-kira setiap 10 detik.
- **Main tanpa akun** tetap bisa untuk main sendiri (progres disimpan di
  browser itu saja). Untuk main online harus login.
- **Admin:** akun bernama **Daniel**, **Nadine** (akun `naddd`), **Prabu** dan **Shallom**
  adalah admin di **semua** room (huruf besar/kecil tidak berpengaruh). Hanya
  admin yang punya tombol **🛡 Player**, dan admin tidak bisa mem-ban admin
  lain. Di situ muncul semua pemain di
  room itu, monster apa yang sudah mereka curi dan dari siapa, dengan tombol:
  - **↩ Return to …** — monster curian dikembalikan ke pemiliknya (langsung
    masuk base kalau pemiliknya sedang online; kalau tidak, monsternya
    menunggu di akun pemilik dan datang saat dia main lagi).
  - **⛔ Ban** — pencuri langsung dikeluarkan ("You were banned by the
    admin.") dan tidak bisa membuat atau masuk room lagi.
- **Membatalkan ban:** buka **Realtime Database → Data**, buka `sam` →
  `bans`, cari baris dengan nama pemainnya, lalu klik **🗑 (hapus)** pada
  baris itu.
- **Lupa password:** belum ada fitur reset di game. Pemilik project bisa
  menghapus akunnya di **Authentication → Users** (cari
  `nama@players.steal-a-monster.game`) dan datanya di
  **Realtime Database → sam → accounts**; setelah itu nama tersebut bisa
  didaftarkan lagi (progresnya hilang).

## Hal penting yang perlu diketahui (jujur)

- **Browser pembuat room adalah servernya.** Kalau pembuat room menutup tab,
  internetnya putus, atau laptopnya tidur, room tertutup untuk semua orang dan
  teman akan melihat pesan *"The room was closed"*. Game dibuat supaya tetap
  jalan walaupun kamu pindah ke tab lain, tapi hal ini belum diuji di semua
  browser. Paling aman, biarkan tab game tetap terbuka di depan.
- **Progres disimpan di akun tiap pemain** (lihat bagian di atas), tetapi
  selama main, game di browser **pembuat room** yang menghitung semuanya lalu
  mengirim progres teman ke akun teman setiap ~10 detik. Kalau room tertutup
  mendadak, beberapa detik terakhir bisa hilang.
- **Data akun bisa dibaca pemain yang login** (pembuat room perlu membaca
  progres temannya). Isinya hanya data game (monster, uang, dll.), bukan
  password; password disimpan oleh Firebase Authentication dan tidak bisa
  dibaca siapa pun.
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
| *"Accounts are not switched on yet…"* | Login Email/Password belum dinyalakan (Langkah 3b). |
| *"The account database refused this…"* atau *permission denied* saat login/simpan | Rules baru (Langkah 3) belum di-**Publish**. |
| *"That name is already taken"* | Nama itu sudah dipakai orang lain (huruf besar/kecil dan spasi tidak membedakan). Pilih nama lain. |
| *"This account is banned from online rooms."* | Akun itu di-ban oleh admin. Lihat cara membatalkan ban di atas. |
| *"Not set up yet…"* di bawah tombol online | Config belum masuk, atau websitenya belum diperbarui. Cek tab Actions sudah hijau, lalu tekan Ctrl + F5. |
| *"Room K7QZP was not found"* | Kodenya salah, atau pembuat room sudah menutup game-nya. Minta link baru. |
| *"Your friend has a different version"* | Salah satu masih memakai versi lama. Kalian berdua tekan Ctrl + F5. |
| *"Could not open an online room (… permission denied …)"* | Rules (Langkah 3) belum di-**Publish**, atau `databaseURL` di config salah. |
| Teman sering "tertarik balik" atau lag | Internet pembuat room kurang stabil. Pakai Wi-Fi, dan pastikan database di **Singapore**. |

---

## Untuk developer: menguji tanpa akun Firebase

Game ini sudah diuji dengan **Firebase Local Emulator Suite** (versi lokal
resmi dari Google: Authentication + Realtime Database, butuh Java) dan
Firebase SDK yang asli. `firebase.json` di folder ini sudah memakai
`firebase-database.rules.json`:

```bash
cd steal-a-monster
npx firebase-tools@13 emulators:start --only auth,database --project demo-sam &
node scripts/build-web.mjs
node scripts/room-e2e.mjs 127.0.0.1:9000 127.0.0.1:9099
node scripts/rules-check.mjs
```

Tes itu membuka beberapa browser: admin `daniel` login dan membuat room, teman
membuat akun dan masuk lewat link, berjalan, bertarung, merekrut monster, dan
pulang ke base; progres teman tersimpan di akunnya dan muncul lagi di game
teman sendiri (dengan pertanyaan *start over / continue*); lalu daniel
mengembalikan monster curian dan mem-ban pencurinya. `rules-check.mjs`
mencoba langsung aturan keamanan (siapa boleh menulis apa). Semua kodenya ada di
`public/client/rooms.js`. Firebase SDK dibundel menjadi satu file
`public/vendor/firebase.js` (`node scripts/build-firebase.mjs`), jadi game
tidak bergantung pada CDN.
