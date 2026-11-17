# Kebutuhan Server & Lingkungan Production — Absensi BIGNET

---

## 1. Spesifikasi Minimum & Rekomendasi Server

| Komponen | Minimum | Rekomendasi Production (50–500 Karyawan) |
|---|---|---|
| Sistem Operasi | Ubuntu 22.04 LTS / Debian 12 (x86_64/arm64) | Ubuntu 24.04 LTS 64-bit |
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB – 4 GB |
| Storage | 20 GB SSD | 40 GB+ NVMe SSD (estimasi pertumbuhan foto ~150–400 KB/sesi) |
| Node.js | **v22.14.0+** (`node:sqlite` + TypeScript native) | **v22.x LTS terbaru** |
| Reverse Proxy | Nginx 1.18+ | Nginx 1.24+ dengan HTTP/2 & TLS 1.2/1.3 |
| Process Manager | PM2 atau systemd | PM2 (`fork` mode, 1 instance) atau `systemd` |

---

## 2. Port & Jaringan Firewall

| Port | Protokol | Akses | Fungsi |
|---|---|---|---|
| `80` | TCP | Publik | Redirect otomatis ke HTTPS (`443`) + verifikasi ACME Let's Encrypt |
| `443` | TCP | Publik | Akses aplikasi web & REST/SSE API via HTTPS Nginx |
| `3000` | TCP | `127.0.0.1` (Lokal saja) | Upstream aplikasi Node.js/Express (`HOST=127.0.0.1` di production) |
| `22` | TCP | Terbatas (Admin IP/VPN) | SSH administrasi server |

---

## 3. Kebutuhan Klien / Browser Pengguna

- Browser modern (Chrome Android/Desktop, Safari iOS 15+, Edge, Firefox) dengan dukungan **WebRTC `navigator.mediaDevices.getUserMedia`** dan **HTML5 Geolocation**.
- Koneksi **HTTPS wajib aktif** agar browser mengizinkan akses kamera langsung dan lokasi GPS karyawan.
- Tidak memerlukan instalasi aplikasi mobile native tambahan.
