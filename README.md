# Beautiful Bot

Bot Discord untuk mengirim pesan yang rapi: satu kotak dengan garis warna di kiri, banner gambar di paling atas, lalu teksnya di bawahnya. Semua dari satu command, tanpa konfigurasi per server.

Dibangun dengan **discord.js v14 (CommonJS)** dan **Components V2**, jadi tidak ada `EmbedBuilder` sama sekali.

---

## Fitur

- Satu slash command global: `/beautiful-message`
- Modal **Beautiful Message Builder** dengan tiga field:
  1. **Post Channel** — Channel Select Menu, hanya channel teks dan channel pengumuman
  2. **Message Body** — textarea, maksimal 4000 karakter
  3. **Banner Image URL** — opsional, harus diawali `http://` atau `https://`
- Tata letak pesan: banner (MediaGallery) lalu teks (TextDisplay), dibungkus `ContainerBuilder` dengan accent color `0x5865f2`
- Markdown dan emoji tetap jalan, karena isinya teks Discord biasa, bukan embed
- `@everyone` atau `@here` otomatis jadi ping terpisah di atas kotak, **hanya** kalau bot dan pemakai command sama-sama punya izin Mention Everyone di channel tujuan
- Izin bot dan batas panjang teks dicek sebelum kirim, dengan pesan error yang jelas

---

## Requirements

- Node.js 18 atau lebih baru
- Akun Discord untuk membuat bot

---

## 1. Membuat aplikasi di Developer Portal

1. Buka [Discord Developer Portal](https://discord.com/developers/applications), lalu klik **New Application**.
2. Beri nama, misalnya `Beautiful Bot`, lalu tekan **Create**.
3. Masuk ke menu **Bot** di sidebar, klik **Reset Token**, lalu simpan tokennya. Token ini jadi `DISCORD_TOKEN`.
4. Di halaman **Bot**, scroll ke bagian **Privileged Gateway Intents**. Bot ini hanya butuh intent **Guilds**, jadi tidak ada yang perlu dinyalakan.
5. Catat **Application ID** di menu **General Information**. Angka ini jadi `CLIENT_ID`.
6. Buka menu **OAuth2 > URL Generator** untuk membuat URL undangan (langkah berikutnya).

---

## 2. Scope undangan

Centang dua scope ini di URL Generator:

| Scope | Kenapa perlu |
|---|---|
| `bot` | Supaya bot bisa masuk ke server dan mengirim pesan |
| `applications.commands` | Supaya `/beautiful-message` muncul di daftar command |

Di tab yang sama, pada bagian **Bot Permissions**, centang:

| Permission | Kenapa perlu |
|---|---|
| View Channels | Melihat channel tujuan |
| Send Messages | Mengirim pesan |
| Embed Links | Merender banner dari URL |
| Mention Everyone | Hanya perlu kalau kamu ingin `@everyone` benar-benar berbunyi |

Salin URL yang dihasilkan, buka di browser, pilih server tujuan, lalu selesaikan undangan.

> Kalau kamu tidak butuh `@everyone`, **Mention Everyone** boleh tidak dicentang. Pesan tetap terkirim normal, hanya tidak ada bunyi ping.

---

## 3. Menjalankan

```bash
cd beautiful-bot
npm install

cp .env.example .env
```

Isi `.env`:

```
DISCORD_TOKEN=token-dari-developer-portal
CLIENT_ID=application-id-dari-developer-portal
```

Lalu jalankan:

```bash
npm start
```

Kalau benar, terminal akan menampilkan:

```
Login berhasil sebagai BeautifulBot#1234
Command /beautiful-message terdaftar secara global.
```

Kalau `.env` belum diisi, bot berhenti dengan pesan error yang menyebutkan `DISCORD_TOKEN` atau `CLIENT_ID`.

---

## Catatan penting: command global butuh propagasi

Command dikirim tanpa `guildId`, jadi berlaku untuk **semua server** tempat bot berada. Enaknya, bot langsung bisa dipakai di server baru tanpa konfigurasi tambahan. Konsekuensinya:

- Setelah bot dijalankan pertama kali, command bisa baru muncul **sampai sekitar 1 jam** kemudian. Ini perilaku normal dari Discord, bukan bug.
- Tiap kali bot start ulang, command dikirim ulang ke Discord, jadi command tidak akan hilang.
- Beberapa menit setelah undangan, command biasanya sudah muncul di server yang baru kamu masukkan.

Kalau `/beautiful-message` belum nongol, cek halaman **Applications** di server kamu untuk memastikan scope `applications.commands` sudah terotorisasi, lalu tunggu propagasinya selesai.

Butuh command yang langsung aktif di satu server? Daftarkan dengan `Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)`. Cara ini justru butuh konfigurasi per server, jadi di proyek ini sengaja tidak dipakai.

---

## Cara pakai

1. Invite bot ke server seperti langkah di atas.
2. Ketik `/beautiful-message` di channel mana pun.
3. Isi modalnya:
   - Pilih channel tujuan (channel teks atau pengumuman).
   - Tulis isi pesan, boleh markdown dan emoji.
   - Isi URL banner kalau mau, kosongkan kalau tidak.
4. Setelah dikirim, kamu dapat balasan konfirmasi **ephemeral** (hanya kamu yang lihat) berisi link ke pesan yang terkirim.

Kalau teks memuat `@everyone` atau `@here` tetapi izin Mention Everyone belum ada di channel tujuan, pesan tetap terkirim tanpa bunyi ping dan kamu diberi tahu lewat balasan ephemeral itu.

---

## Struktur file

```
beautiful-bot/
├── index.js          # seluruh logika bot
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

---

## Keamanan

- **Jangan commit `.env`** — sudah masuk `.gitignore`. Kalau token bocor, tekan **Reset Token** di Developer Portal.
- Beri izin sekecil mungkin. Bot ini tidak butuh Administrator, Manage Server, atau intent Message Content.

## Lisensi

MIT.