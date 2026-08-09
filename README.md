# AFROJ GLOBAL VENTURES — Live App

A complete e-commerce PWA (like Flipkart) with a real backend. All data is stored
on the server, so **every customer, seller, delivery boy, and admin sees the same
live data from any phone**. No data is lost between devices.

## Roles
| Role | How they log in | What they do |
|------|----------------|--------------|
| **Admin** | Mobile `9264411779` / Password `Afroj@27` | Add/edit/delete products, approve sellers, accept & assign orders, manage everything |
| **Seller** | Register → Admin approves → login | Add products (admin approves), manage own orders |
| **Customer** | Mobile + OTP | Browse, cart, checkout, track orders |
| **Delivery Boy** | Register → Admin assigns → login | Accept deliveries, mark out-for-delivery, delivered |

## Run locally
```bash
cd build
node server.js
# open http://localhost:8090
```

## Deploy (FREE — Koyeb recommended)

### Option A: Koyeb (free, runs Node.js 24/7, sleeps after 1hr idle then auto-wakes)
1. Create a free account at https://www.koyeb.com
2. Install CLI: `curl -fsSL https://raw.githubusercontent.com/koyeb/koyeb-cli/master/install.sh | sh`
3. Login: `koyeb login`  (opens browser)
4. From this folder: `koyeb deploy . afroj-global/main --ports 8090:/http`
5. Your app is live at `https://afroj-global-main-xxxx.koyeb.app`
6. (Optional) Add a persistent volume so data survives redeploys — see Koyeb docs.

### Option B: Render (free, sleeps after 15min idle)
1. Push this folder to a GitHub repo.
2. Go to https://render.com → New → Web Service → connect the repo.
3. Build Command: `npm install`  |  Start Command: `node server.js`

### Option C: Any Docker host
```bash
docker build -t afroj-global .
docker run -p 8090:8090 -v agv-data:/app/data afroj-global
```

## Files
```
build/
├── server.js          # Node.js HTTP server + REST API (no dependencies)
├── package.json
├── Dockerfile         # For container platforms
├── Procfile           # For Heroku-style platforms
└── deploy/            # PWA frontend (HTML, CSS, JS, manifest, service worker, icons)
    ├── index.html
    ├── manifest.json
    ├── sw.js
    ├── css/style.css
    ├── js/app.js
    └── *.png / *.svg
```

## Install as an app on your phone
Open the live link in Chrome → browser menu (⋮) → **Install app** / **Add to Home screen**.
It installs like a native app with its own icon.
