/* ============================================================
   AFROJ GLOBAL VENTURES - Single Production Server
   Serves PWA static files + full REST API (JSON file storage).
   Data lives ONLY on the server -> every phone sees the same live data.
   ============================================================ */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8090;
const DATA_DIR = path.join(__dirname, 'data');
const DEPLOY_DIR = path.join(__dirname, 'deploy');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Data Storage (JSON files) ----------
function loadData(file, fallback) {
  const fp = path.join(DATA_DIR, file);
  try {
    if (!fs.existsSync(fp)) return fallback;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) { return fallback; }
}
function saveData(file, data) {
  const fp = path.join(DATA_DIR, file);
  // atomic write
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, fp);
}

// In-memory OTP store (not persisted)
const OTPS = {};

// ---------- Seed Data ----------
function initData() {
  if (!loadData('products.json')) {
    const seed = [
      { id:'P001', sellerId:'ADMIN', sellerMobile:null, name:'Wireless Bluetooth Earbuds Pro', category:'Electronics', description:'Premium wireless earbuds with charging case, deep bass and 30hr battery life.', price:1299, mrp:2000, deliveryCharge:0, stock:25, deliveryDays:3, images:['https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&h=600&fit=crop','https://images.unsplash.com/photo-1484704849700-f032a568e944?w=600&h=600&fit=crop'], status:'live', createdAt:Date.now() },
      { id:'P002', sellerId:'ADMIN', sellerMobile:null, name:'Smart Fitness Band Watch', category:'Electronics', description:'Fitness band with heart rate monitor, step counter and sleep tracking. Water resistant.', price:899, mrp:1000, deliveryCharge:0, stock:40, deliveryDays:3, images:['https://images.unsplash.com/photo-1575311373937-040b8e1fd5b6?w=600&h=600&fit=crop'], status:'live', createdAt:Date.now() },
      { id:'P003', sellerId:'ADMIN', sellerMobile:null, name:'Luxury Leather Handbag', category:'Fashion', description:'Premium genuine leather handbag with gold-tone hardware. Elegant design for every occasion.', price:4999, mrp:6500, deliveryCharge:49, stock:15, deliveryDays:4, images:['https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=600&h=600&fit=crop','https://images.unsplash.com/photo-1591561954557-26941169b49e?w=600&h=600&fit=crop'], status:'live', createdAt:Date.now() },
      { id:'P004', sellerId:'ADMIN', sellerMobile:null, name:'Classic Gold Wristwatch', category:'Fashion', description:'Stylish analog wristwatch with gold-plated case and leather strap. Water resistant.', price:6499, mrp:8000, deliveryCharge:0, stock:8, deliveryDays:4, images:['https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=600&h=600&fit=crop'], status:'live', createdAt:Date.now() },
      { id:'P005', sellerId:'ADMIN', sellerMobile:null, name:'Aviator Sunglasses', category:'Accessories', description:'Classic aviator sunglasses with UV400 protection. Gold frame with gradient lenses.', price:1999, mrp:2999, deliveryCharge:30, stock:25, deliveryDays:3, images:['https://images.unsplash.com/photo-1473496169904-658ba7c44d8a?w=600&h=600&fit=crop'], status:'live', createdAt:Date.now() },
      { id:'P006', sellerId:'ADMIN', sellerMobile:null, name:'Designer Perfume 100ml', category:'Beauty', description:'Long-lasting luxury perfume with floral and woody notes. 100ml premium glass bottle.', price:2799, mrp:3500, deliveryCharge:35, stock:18, deliveryDays:4, images:['https://images.unsplash.com/photo-1541643600914-78b084683601?w=600&h=600&fit=crop'], status:'live', createdAt:Date.now() }
    ];
    saveData('products.json', seed);
  }
  if (!loadData('sellerProducts.json')) saveData('sellerProducts.json', []);
  if (!loadData('orders.json')) saveData('orders.json', []);
  if (!loadData('registrations.json')) saveData('registrations.json', []);
  if (!loadData('sessions.json')) saveData('sessions.json', []);
  if (!loadData('users.json')) saveData('users.json', { customers: [] });
  if (!loadData('settings.json')) {
    saveData('settings.json', {
      storeName: 'AFROJ GLOBAL VENTURES',
      storeTagline: 'Luxury Shopping, Delivered to You',
      adminMobile: '9264411779',
      adminPassword: 'Afroj@27',
      defaultDeliveryCharge: 40
    });
  }
}
initData();

// ---------- Helpers ----------
function genId(prefix) { return prefix + Date.now().toString(36).toUpperCase() + Math.floor(Math.random()*10000); }
function genOTP() { return String(Math.floor(100000 + Math.random()*900000)); }
function nowISO() { return new Date().toISOString(); }

// ---------- Fast2SMS Real OTP Integration ----------
// Read API key from environment variable (set in Render dashboard)
const F2S_API_KEY = process.env.F2S_API_KEY || process.env.FAST2SMS_API_KEY || '';
const OTP_MODE = F2S_API_KEY ? 'sms' : 'demo'; // 'sms' = real SMS, 'demo' = show on screen

// Send real OTP SMS via Fast2SMS Quick SMS route (no DLT registration needed)
function sendFast2SMS(phone, otp, cb) {
  const message = `${otp} is your AFROJ GLOBAL VENTURES verification code. Do not share it with anyone.`;
  const postData = JSON.stringify({
    route: 'q',              // Quick SMS route (premium, no DLT required)
    message: message,
    language: 'english',
    flash: 0,
    numbers: phone           // 10-digit number, no country code
  });
  const options = {
    hostname: 'www.fast2sms.com',
    path: '/dev/bulkV2',
    method: 'POST',
    headers: {
      'authorization': F2S_API_KEY,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  const smsReq = https.request(options, (smsRes) => {
    let data = '';
    smsRes.on('data', chunk => data += chunk);
    smsRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        cb(parsed);
      } catch(e) {
        cb({ return: false, message: 'SMS provider parse error', raw: data });
      }
    });
  });
  smsReq.on('error', (e) => {
    cb({ return: false, message: 'SMS network error: ' + e.message });
  });
  smsReq.write(postData);
  smsReq.end();
}
function genOrderId() {
  const d = new Date();
  const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getMonth()];
  return 'AFS' + String(d.getDate()).padStart(2,'0') + mon + d.getFullYear() + String(Math.floor(Math.random()*9000)+1000);
}

// ---------- Auth / Session ----------
function createSession(role, refId) {
  const sessions = loadData('sessions.json', []);
  const token = genId('TOK');
  sessions.push({ token, role, refId: refId || null, created: Date.now() });
  saveData('sessions.json', sessions);
  return token;
}
function getSession(token) {
  if (!token) return null;
  const sessions = loadData('sessions.json', []);
  return sessions.find(s => s.token === token) || null;
}
function destroySession(token) {
  let sessions = loadData('sessions.json', []);
  sessions = sessions.filter(s => s.token !== token);
  saveData('sessions.json', sessions);
}
function userFromSession(sess) {
  if (!sess) return null;
  if (sess.role === 'admin') return { id:'ADMIN', role:'admin', name:'Admin' };
  if (sess.role === 'customer') {
    const users = loadData('users.json', { customers: [] });
    const c = users.customers.find(c => c.id === sess.refId);
    return c ? Object.assign({}, c, { role:'customer' }) : null;
  }
  // seller or delivery
  const regs = loadData('registrations.json', []);
  const r = regs.find(r => r.id === sess.refId);
  return r ? { id:r.id, role:r.role, name:r.name, mobile:r.mobile, city:r.city, shop:r.shop, status:r.status } : null;
}

// ---------- HTTP Server ----------
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method;

  function readBody(cb) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { cb(body ? JSON.parse(body) : {}); }
      catch(e) { cb(null); }
    });
  }
  function sendJSON(data, status) {
    res.writeHead(status || 200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }
  function sendError(msg, status) {
    res.writeHead(status || 400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: msg }));
  }
  function authUser() {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    return userFromSession(getSession(token));
  }

  // ========== STATIC FILES (PWA) ==========
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const fp = path.join(DEPLOY_DIR, 'index.html');
    if (fs.existsSync(fp)) { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(fs.readFileSync(fp)); return; }
    return sendError('index.html not found', 404);
  }
  // Serve API only under /api
  if (pathname.startsWith('/api/')) { /* fall through to API below */ }
  else if (method === 'GET') {
    // serve static asset from deploy dir (relative path)
    let rel = decodeURIComponent(pathname);
    if (rel.includes('..')) return sendError('Forbidden', 403);
    const fp = path.join(DEPLOY_DIR, rel);
    if (fp.startsWith(DEPLOY_DIR) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const ext = path.extname(fp).toLowerCase();
      const MIME = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webp':'image/webp', '.woff':'font/woff', '.woff2':'font/woff2' };
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(fp).pipe(res);
      return;
    }
    // For SPA-ish navigation, fallback to index.html
    if (!pathname.includes('.')) {
      const idx = path.join(DEPLOY_DIR, 'index.html');
      if (fs.existsSync(idx)) { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(fs.readFileSync(idx)); return; }
    }
    return sendError('Not found', 404);
  }

  // ========== API ROUTES ==========
  if (pathname === '/api/health' && method === 'GET') {
    return sendJSON({ status:'ok', server:'AFROJ GLOBAL VENTURES API', time:Date.now(), products:(loadData('products.json',[])).length, orders:(loadData('orders.json',[])).length });
  }

  // ----- SETTINGS -----
  if (pathname === '/api/settings' && method === 'GET') {
    const s = loadData('settings.json', {});
    // Don't expose admin password
    return sendJSON({ storeName:s.storeName, storeTagline:s.storeTagline, adminMobile:s.adminMobile, defaultDeliveryCharge:s.defaultDeliveryCharge });
  }
  if (pathname === '/api/settings' && method === 'POST') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    return readBody(body => {
      const s = loadData('settings.json', {});
      if (body.storeName) s.storeName = body.storeName;
      if (body.storeTagline) s.storeTagline = body.storeTagline;
      if (body.adminMobile) s.adminMobile = body.adminMobile;
      if (body.adminPassword) s.adminPassword = body.adminPassword;
      if (body.defaultDeliveryCharge !== undefined) s.defaultDeliveryCharge = body.defaultDeliveryCharge;
      s.updatedAt = nowISO();
      saveData('settings.json', s);
      sendJSON({ success:true, settings:{ storeName:s.storeName, storeTagline:s.storeTagline, adminMobile:s.adminMobile, defaultDeliveryCharge:s.defaultDeliveryCharge } });
    });
  }

  // ----- PRODUCTS (customer view: only live + approved seller products) -----
  if (pathname === '/api/products' && method === 'GET') {
    const products = loadData('products.json', []).filter(p => p.status === 'live' || !p.status);
    const sellerProducts = (loadData('sellerProducts.json', [])).filter(p => p.status === 'approved');
    // merge: seller approved products appear as live products to customers
    const merged = products.concat(sellerProducts.map(p => ({
      id: p.id, name:p.name, category:p.category, price:p.price, mrp:p.mrp, deliveryCharge:p.deliveryCharge,
      stock:p.stock, deliveryDays:p.deliveryDays, images:p.images, image:p.images && p.images[0],
      description:p.description, status:'live', sellerProductId:p.id, sellerMobile:p.sellerMobile, sellerName:p.sellerName, createdAt:p.createdAt
    })));
    return sendJSON({ products: merged });
  }

  // ----- ADMIN/Seller: own products management -----
  if (pathname === '/api/admin/products' && method === 'GET') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    return sendJSON({ products: loadData('products.json', []) });
  }
  if (pathname === '/api/admin/products' && method === 'POST') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    return readBody(body => {
      if (!body.name || !body.price) return sendError('Name and price required');
      const products = loadData('products.json', []);
      const p = {
        id: genId('P'), sellerId:'ADMIN', sellerMobile:null,
        name:body.name, category:body.category||'General', description:body.description||'',
        price:Number(body.price), mrp:body.mrp?Number(body.mrp):Number(body.price),
        deliveryCharge:Number(body.deliveryCharge)||0, stock:Number(body.stock)||0,
        deliveryDays:Number(body.deliveryDays)||3, images:body.images||[], image:body.images&&body.images[0],
        status:'live', createdAt:nowISO()
      };
      products.push(p); saveData('products.json', products);
      sendJSON({ success:true, product:p });
    });
  }
  if (pathname.startsWith('/api/admin/products/') && method === 'PUT') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    const pid = pathname.split('/')[4];
    return readBody(body => {
      const products = loadData('products.json', []);
      const idx = products.findIndex(p => p.id === pid);
      if (idx === -1) return sendError('Product not found', 404);
      products[idx] = Object.assign(products[idx], {
        name:body.name!==undefined?body.name:products[idx].name,
        category:body.category!==undefined?body.category:products[idx].category,
        description:body.description!==undefined?body.description:products[idx].description,
        price:body.price!==undefined?Number(body.price):products[idx].price,
        mrp:body.mrp!==undefined?Number(body.mrp):products[idx].mrp,
        deliveryCharge:body.deliveryCharge!==undefined?Number(body.deliveryCharge):products[idx].deliveryCharge,
        stock:body.stock!==undefined?Number(body.stock):products[idx].stock,
        deliveryDays:body.deliveryDays!==undefined?Number(body.deliveryDays):products[idx].deliveryDays,
        images:body.images!==undefined?body.images:products[idx].images,
        image:body.images!==undefined?(body.images[0]||null):products[idx].image,
        status:body.status!==undefined?body.status:products[idx].status
      }, { id:pid, updatedAt:nowISO() });
      saveData('products.json', products);
      sendJSON({ success:true, product:products[idx] });
    });
  }
  if (pathname.startsWith('/api/admin/products/') && method === 'DELETE') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    const pid = pathname.split('/')[4];
    let products = loadData('products.json', []);
    products = products.filter(p => p.id !== pid);
    saveData('products.json', products);
    return sendJSON({ success:true });
  }

  // ----- SELLER PRODUCTS -----
  // All seller products (admin view)
  if (pathname === '/api/seller-products' && method === 'GET') {
    const u = authUser();
    if (!u || (u.role !== 'admin' && u.role !== 'seller')) return sendError('Auth required', 403);
    let sp = loadData('sellerProducts.json', []);
    if (u.role === 'seller') sp = sp.filter(p => p.sellerMobile === u.mobile);
    return sendJSON({ sellerProducts: sp });
  }
  // Seller adds a product -> status pending
  if (pathname === '/api/seller-products' && method === 'POST') {
    const u = authUser();
    if (!u || u.role !== 'seller') return sendError('Seller auth required', 403);
    return readBody(body => {
      if (!body.name || !body.price) return sendError('Name and price required');
      if (!body.images || body.images.length === 0) return sendError('At least 1 image required');
      const sp = loadData('sellerProducts.json', []);
      const p = {
        id: genId('SP'), name:body.name, category:body.category||'General', description:body.description||'',
        price:Number(body.price), mrp:body.mrp?Number(body.mrp):Number(body.price),
        deliveryCharge:Number(body.deliveryCharge)||0, stock:Number(body.stock)||0,
        deliveryDays:Number(body.deliveryDays)||3, images:body.images, image:body.images[0],
        sellerMobile:u.mobile, sellerName:u.name, sellerId:u.id,
        status:'pending', createdAt:nowISO()
      };
      sp.push(p); saveData('sellerProducts.json', sp);
      sendJSON({ success:true, product:p });
    });
  }
  // Seller edits own pending/rejected product
  if (pathname.startsWith('/api/seller-products/') && method === 'PUT') {
    const u = authUser();
    if (!u || (u.role !== 'seller' && u.role !== 'admin')) return sendError('Auth required', 403);
    const spId = pathname.split('/')[3];
    return readBody(body => {
      const sp = loadData('sellerProducts.json', []);
      const idx = sp.findIndex(p => p.id === spId);
      if (idx === -1) return sendError('Not found', 404);
      if (u.role === 'seller' && sp[idx].sellerMobile !== u.mobile) return sendError('Not your product', 403);
      sp[idx] = Object.assign(sp[idx], {
        name:body.name!==undefined?body.name:sp[idx].name,
        category:body.category!==undefined?body.category:sp[idx].category,
        description:body.description!==undefined?body.description:sp[idx].description,
        price:body.price!==undefined?Number(body.price):sp[idx].price,
        mrp:body.mrp!==undefined?Number(body.mrp):sp[idx].mrp,
        deliveryCharge:body.deliveryCharge!==undefined?Number(body.deliveryCharge):sp[idx].deliveryCharge,
        stock:body.stock!==undefined?Number(body.stock):sp[idx].stock,
        deliveryDays:body.deliveryDays!==undefined?Number(body.deliveryDays):sp[idx].deliveryDays,
        images:body.images!==undefined?body.images:sp[idx].images,
        image:body.images!==undefined?(body.images[0]||null):sp[idx].image,
        status:body.status!==undefined?body.status:sp[idx].status
      }, { id:spId, updatedAt:nowISO() });
      saveData('sellerProducts.json', sp);
      sendJSON({ success:true, product:sp[idx] });
    });
  }
  if (pathname.startsWith('/api/seller-products/') && method === 'DELETE') {
    const u = authUser();
    if (!u || (u.role !== 'seller' && u.role !== 'admin')) return sendError('Auth required', 403);
    const spId = pathname.split('/')[3];
    let sp = loadData('sellerProducts.json', []);
    const target = sp.find(p => p.id === spId);
    if (!target) return sendError('Not found', 404);
    if (u.role === 'seller' && target.sellerMobile !== u.mobile) return sendError('Not your product', 403);
    sp = sp.filter(p => p.id !== spId);
    saveData('sellerProducts.json', sp);
    return sendJSON({ success:true });
  }

  // Admin approve seller product -> it becomes visible to customers (status approved)
  if (pathname.startsWith('/api/seller-products/') && pathname.endsWith('/approve') && method === 'POST') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    const spId = pathname.split('/')[3];
    return readBody(body => {
      const sp = loadData('sellerProducts.json', []);
      const idx = sp.findIndex(p => p.id === spId);
      if (idx === -1) return sendError('Not found', 404);
      // allow admin to edit fields during approval
      if (body.name) sp[idx].name = body.name;
      if (body.price !== undefined) sp[idx].price = Number(body.price);
      if (body.mrp !== undefined) sp[idx].mrp = Number(body.mrp);
      if (body.stock !== undefined) sp[idx].stock = Number(body.stock);
      if (body.deliveryCharge !== undefined) sp[idx].deliveryCharge = Number(body.deliveryCharge);
      if (body.deliveryDays !== undefined) sp[idx].deliveryDays = Number(body.deliveryDays);
      if (body.category) sp[idx].category = body.category;
      if (body.description !== undefined) sp[idx].description = body.description;
      if (body.images) sp[idx].images = body.images;
      sp[idx].status = 'approved';
      sp[idx].approvedAt = nowISO();
      saveData('sellerProducts.json', sp);
      sendJSON({ success:true, product:sp[idx] });
    });
  }
  if (pathname.startsWith('/api/seller-products/') && pathname.endsWith('/reject') && method === 'POST') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    const spId = pathname.split('/')[3];
    return readBody(body => {
      const sp = loadData('sellerProducts.json', []);
      const idx = sp.findIndex(p => p.id === spId);
      if (idx === -1) return sendError('Not found', 404);
      sp[idx].status = 'rejected';
      sp[idx].rejectionReason = body.reason || '';
      sp[idx].updatedAt = nowISO();
      saveData('sellerProducts.json', sp);
      sendJSON({ success:true, product:sp[idx] });
    });
  }

  // ----- CUSTOMER OTP / LOGIN -----
  // New endpoint: check which OTP mode is active (sms or demo)
  if (pathname === '/api/customer/otp-mode' && method === 'GET') {
    return sendJSON({ mode: OTP_MODE });
  }

  if (pathname === '/api/customer/send-otp' && method === 'POST') {
    return readBody(body => {
      if (!body.phone || !/^\d{10}$/.test(body.phone)) return sendError('Invalid 10-digit mobile number');
      const users = loadData('users.json', { customers:[] });
      const existing = users.customers.find(c => c.mobile === body.phone);
      if (existing && existing.status === 'blocked') return sendError('Your account is blocked. Contact admin.');
      const otp = genOTP();
      OTPS[body.phone] = { otp, expires: Date.now() + 300000, attempts: 0 };

      // Real SMS mode: send via Fast2SMS, do NOT return OTP in response
      if (OTP_MODE === 'sms' && F2S_API_KEY) {
        return sendFast2SMS(body.phone, otp, (result) => {
          if (result && result.return === true) {
            return sendJSON({ success: true, mode: 'sms', message: 'OTP sent to your mobile via SMS. Please check your messages.' });
          } else {
            // SMS failed (low balance / invalid key) — fall back to demo for this request only
            const errMsg = (result && result.message) ? result.message : 'SMS sending failed';
            return sendJSON({ success: true, mode: 'demo', otp: otp, message: 'SMS could not be sent (' + errMsg + '). For demo: use this OTP', fallback: true });
          }
        });
      }

      // Demo mode: return OTP in response (shown on screen)
      return sendJSON({ success: true, mode: 'demo', otp: otp, message: 'OTP sent successfully (demo mode - shown on screen)' });
    });
  }
  if (pathname === '/api/customer/resend-otp' && method === 'POST') {
    return readBody(body => {
      if (!body.phone || !/^\d{10}$/.test(body.phone)) return sendError('Invalid 10-digit mobile number');
      const stored = OTPS[body.phone];
      if (!stored) return sendError('Please request a new OTP first');
      if (Date.now() > stored.expires) return sendError('OTP expired, please request a new one');
      const otp = stored.otp; // reuse same OTP within validity window

      if (OTP_MODE === 'sms' && F2S_API_KEY) {
        return sendFast2SMS(body.phone, otp, (result) => {
          if (result && result.return === true) {
            return sendJSON({ success: true, mode: 'sms', message: 'OTP re-sent to your mobile via SMS.' });
          } else {
            const errMsg = (result && result.message) ? result.message : 'SMS sending failed';
            return sendJSON({ success: true, mode: 'demo', otp: otp, message: 'SMS could not be sent (' + errMsg + '). For demo: use this OTP', fallback: true });
          }
        });
      }
      return sendJSON({ success: true, mode: 'demo', otp: otp, message: 'OTP re-sent (demo mode)' });
    });
  }
  if (pathname === '/api/customer/verify-otp' && method === 'POST') {
    return readBody(body => {
      if (!body.phone || !body.otp) return sendError('Missing phone or OTP');
      const stored = OTPS[body.phone];
      if (!stored || stored.otp !== body.otp) return sendError('Invalid OTP');
      if (Date.now() > stored.expires) return sendError('OTP expired');
      delete OTPS[body.phone];
      const users = loadData('users.json', { customers:[] });
      let cust = users.customers.find(c => c.mobile === body.phone);
      if (!cust) {
        cust = { id:genId('CUST'), mobile:body.phone, name:'', address:'', city:'', pincode:'', status:'active', createdAt:nowISO() };
        users.customers.push(cust); saveData('users.json', users);
      }
      if (cust.status === 'blocked') return sendError('Your account is blocked. Contact admin.');
      const token = createSession('customer', cust.id);
      return sendJSON({ success:true, token, customer:cust });
    });
  }

  // ----- CUSTOMER PROFILE UPDATE -----
  if (pathname === '/api/customer/update' && method === 'POST') {
    const u = authUser();
    if (!u || u.role !== 'customer') return sendError('Customer auth required', 403);
    return readBody(body => {
      const users = loadData('users.json', { customers:[] });
      const cust = users.customers.find(c => c.id === u.id);
      if (!cust) return sendError('Customer not found');
      if (body.name !== undefined) cust.name = body.name;
      if (body.address !== undefined) cust.address = body.address;
      if (body.city !== undefined) cust.city = body.city;
      if (body.pincode !== undefined) cust.pincode = body.pincode;
      cust.updatedAt = nowISO();
      saveData('users.json', users);
      return sendJSON({ success:true, customer:cust });
    });
  }

  // ----- ORDERS -----
  // Customer places order
  if (pathname === '/api/orders' && method === 'POST') {
    const u = authUser();
    if (!u || u.role !== 'customer') return sendError('Customer auth required', 403);
    return readBody(body => {
      if (!body.items || !body.items.length) return sendError('Cart is empty');
      const orders = loadData('orders.json', []);
      const maxDays = Math.max.apply(null, body.items.map(i => i.deliveryDays || 3));
      const expectedDelivery = new Date(Date.now() + maxDays*86400000).toISOString();
      const order = {
        id: genOrderId(),
        customerId: u.id, customerMobile: u.mobile,
        customer: { name:body.customerName||u.name, mobile:u.mobile, address:body.address||'', city:body.city||'', pincode:body.pincode||'' },
        items: body.items,
        subtotal: Number(body.subtotal), delivery: Number(body.delivery), total: Number(body.total),
        status: 'Awaiting Admin',
        statusHistory: [{ status:'Awaiting Admin', time:nowISO(), by:'Customer' }],
        assignedDelivery:null, deliveryName:null, cancelledBy:null,
        deliveryDays:maxDays, expectedDelivery,
        createdAt:nowISO(), updatedAt:nowISO()
      };
      orders.push(order); saveData('orders.json', orders);
      // update customer profile address
      const users = loadData('users.json', { customers:[] });
      const cust = users.customers.find(c => c.id === u.id);
      if (cust) {
        if (body.customerName) cust.name = body.customerName;
        if (body.address) cust.address = body.address;
        if (body.city) cust.city = body.city;
        if (body.pincode) cust.pincode = body.pincode;
        saveData('users.json', users);
      }
      return sendJSON({ success:true, order });
    });
  }
  // Customer's own orders
  if (pathname === '/api/orders/customer' && method === 'GET') {
    const u = authUser();
    if (!u || u.role !== 'customer') return sendError('Customer auth required', 403);
    const orders = (loadData('orders.json', [])).filter(o => o.customerId === u.id).reverse();
    return sendJSON({ orders });
  }
  // Customer cancels own order
  if (pathname.startsWith('/api/orders/') && pathname.endsWith('/cancel') && method === 'POST') {
    const u = authUser();
    if (!u || u.role !== 'customer') return sendError('Customer auth required', 403);
    const oid = pathname.split('/')[3];
    return readBody(body => {
      const orders = loadData('orders.json', []);
      const o = orders.find(o => o.id === oid);
      if (!o) return sendError('Order not found', 404);
      if (o.customerId !== u.id) return sendError('Not your order', 403);
      if (['Delivered','Cancelled','Customer Cancelled','Out for Delivery','Shipped'].includes(o.status))
        return sendError('Cannot cancel this order now');
      o.status = 'Customer Cancelled';
      o.cancelledBy = 'Customer';
      o.updatedAt = nowISO();
      o.statusHistory.push({ status:'Customer Cancelled', time:nowISO(), by:'Customer' });
      saveData('orders.json', orders);
      return sendJSON({ success:true, order:o });
    });
  }

  // Admin: all orders
  if (pathname === '/api/admin/orders' && method === 'GET') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    return sendJSON({ orders: loadData('orders.json', []) });
  }
  // Admin update order status / accept / reject / assign delivery
  if (pathname.startsWith('/api/admin/orders/') && method === 'PUT') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    const oid = pathname.split('/')[4];
    return readBody(body => {
      const orders = loadData('orders.json', []);
      const idx = orders.findIndex(o => o.id === oid);
      if (idx === -1) return sendError('Order not found', 404);
      const o = orders[idx];
      if (body.status) {
        o.status = body.status;
        o.statusHistory.push({ status:body.status, time:nowISO(), by:'Admin', note:body.note||'' });
      }
      if (body.deliveryBoyId !== undefined) {
        const regs = loadData('registrations.json', []);
        const boy = regs.find(r => r.id === body.deliveryBoyId && r.role === 'delivery' && r.status === 'approved');
        if (!boy) return sendError('Approved delivery boy not found', 400);
        o.assignedDelivery = boy.id; o.deliveryName = boy.name; o.deliveryMobile = boy.mobile;
        o.statusHistory.push({ status:'Delivery Boy Assigned: '+boy.name, time:nowISO(), by:'Admin' });
      }
      o.updatedAt = nowISO();
      saveData('orders.json', orders);
      return sendJSON({ success:true, order:o });
    });
  }
  // Admin assign delivery boy (convenience POST)
  if (pathname.startsWith('/api/admin/orders/') && pathname.endsWith('/assign-delivery') && method === 'POST') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    const oid = pathname.split('/')[4];
    return readBody(body => {
      const orders = loadData('orders.json', []);
      const o = orders.find(o => o.id === oid);
      if (!o) return sendError('Order not found', 404);
      const regs = loadData('registrations.json', []);
      const boy = regs.find(r => r.id === body.deliveryBoyId && r.role === 'delivery' && r.status === 'approved');
      if (!boy) return sendError('Approved delivery boy not found', 400);
      o.assignedDelivery = boy.id; o.deliveryName = boy.name; o.deliveryMobile = boy.mobile;
      o.statusHistory.push({ status:'Delivery Boy Assigned: '+boy.name, time:nowISO(), by:'Admin' });
      o.updatedAt = nowISO();
      saveData('orders.json', orders);
      return sendJSON({ success:true, order:o });
    });
  }

  // Seller: orders for their products
  if (pathname === '/api/seller/orders' && method === 'GET') {
    const u = authUser();
    if (!u || u.role !== 'seller') return sendError('Seller auth required', 403);
    const sp = loadData('sellerProducts.json', []);
    const myProductIds = sp.filter(p => p.sellerMobile === u.mobile).map(p => p.id);
    const orders = (loadData('orders.json', [])).filter(o => o.items && o.items.some(i => myProductIds.includes(i.id) || myProductIds.includes(i.sellerProductId)));
    return sendJSON({ orders: orders.reverse() });
  }
  // Seller approves / rejects an order (changes status)
  if (pathname.startsWith('/api/seller/orders/') && method === 'PUT') {
    const u = authUser();
    if (!u || u.role !== 'seller') return sendError('Seller auth required', 403);
    const oid = pathname.split('/')[4];
    return readBody(body => {
      const orders = loadData('orders.json', []);
      const o = orders.find(o => o.id === oid);
      if (!o) return sendError('Order not found', 404);
      if (body.status) {
        o.status = body.status;
        o.statusHistory.push({ status:body.status, time:nowISO(), by:'Seller' });
      }
      o.updatedAt = nowISO();
      saveData('orders.json', orders);
      return sendJSON({ success:true, order:o });
    });
  }

  // Delivery boy: their orders + available
  if (pathname === '/api/delivery/orders' && method === 'GET') {
    const u = authUser();
    if (!u || u.role !== 'delivery') return sendError('Delivery auth required', 403);
    const all = loadData('orders.json', []);
    const myOrders = all.filter(o => o.assignedDelivery === u.id);
    const available = all.filter(o => o.status === 'Awaiting Delivery' && !o.assignedDelivery);
    return sendJSON({ myOrders: myOrders.reverse(), available: available.reverse() });
  }
  // Delivery boy updates order status (accept -> Shipped, Out for Delivery, Delivered)
  if (pathname.startsWith('/api/delivery/orders/') && method === 'PUT') {
    const u = authUser();
    if (!u || u.role !== 'delivery') return sendError('Delivery auth required', 403);
    const oid = pathname.split('/')[4];
    return readBody(body => {
      const orders = loadData('orders.json', []);
      const o = orders.find(o => o.id === oid);
      if (!o) return sendError('Order not found', 404);
      if (body.action === 'accept') {
        if (o.status !== 'Awaiting Delivery') return sendError('Order not available for pickup');
        o.assignedDelivery = u.id; o.deliveryName = u.name; o.deliveryMobile = u.mobile;
        o.status = 'Shipped';
        o.statusHistory.push({ status:'Shipped - Delivery boy accepted: '+u.name, time:nowISO(), by:'Delivery' });
      } else if (body.status) {
        if (o.assignedDelivery !== u.id) return sendError('Not assigned to you', 403);
        o.status = body.status;
        o.statusHistory.push({ status:body.status, time:nowISO(), by:'Delivery' });
      }
      o.updatedAt = nowISO();
      saveData('orders.json', orders);
      return sendJSON({ success:true, order:o });
    });
  }

  // ----- REGISTRATIONS -----
  if (pathname === '/api/registrations' && method === 'GET') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    return sendJSON({ registrations: loadData('registrations.json', []) });
  }
  if (pathname === '/api/registrations' && method === 'POST') {
    return readBody(body => {
      if (!body.role || !body.name || !body.mobile || !body.city) return sendError('Missing required fields');
      if (!/^\d{10}$/.test(body.mobile)) return sendError('Invalid mobile number');
      const regs = loadData('registrations.json', []);
      if (regs.find(r => r.mobile === body.mobile && r.status !== 'rejected')) {
        return sendError('This mobile already has a pending/approved registration');
      }
      const reg = {
        id: genId('REG'), role:body.role, name:body.name, mobile:body.mobile, city:body.city,
        shop:body.shop||'', aadhar:body.aadhar||'', aadharPhoto:body.aadharPhoto||'', photo:body.photo||'',
        password:'', status:'pending', createdAt:nowISO()
      };
      regs.push(reg); saveData('registrations.json', regs);
      return sendJSON({ success:true, registration:reg });
    });
  }
  // Admin approve registration + set password
  if (pathname.startsWith('/api/registrations/') && pathname.endsWith('/approve') && method === 'POST') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    const rid = pathname.split('/')[3];
    return readBody(body => {
      if (!body.password || body.password.length < 4) return sendError('Password must be at least 4 characters');
      const regs = loadData('registrations.json', []);
      const r = regs.find(r => r.id === rid);
      if (!r) return sendError('Not found', 404);
      r.status = 'approved'; r.password = body.password; r.approvedAt = nowISO();
      saveData('registrations.json', regs);
      return sendJSON({ success:true, registration:r });
    });
  }
  if (pathname.startsWith('/api/registrations/') && pathname.endsWith('/reject') && method === 'POST') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    const rid = pathname.split('/')[3];
    return readBody(body => {
      const regs = loadData('registrations.json', []);
      const r = regs.find(r => r.id === rid);
      if (!r) return sendError('Not found', 404);
      r.status = 'rejected'; r.rejectionReason = body.reason||''; r.updatedAt = nowISO();
      saveData('registrations.json', regs);
      return sendJSON({ success:true, registration:r });
    });
  }
  if (pathname.startsWith('/api/registrations/') && pathname.endsWith('/block') && method === 'POST') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    const rid = pathname.split('/')[3];
    return readBody(body => {
      const regs = loadData('registrations.json', []);
      const r = regs.find(r => r.id === rid);
      if (!r) return sendError('Not found', 404);
      r.status = 'blocked'; r.updatedAt = nowISO();
      saveData('registrations.json', regs);
      return sendJSON({ success:true, registration:r });
    });
  }
  if (pathname.startsWith('/api/registrations/') && pathname.endsWith('/unblock') && method === 'POST') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    const rid = pathname.split('/')[3];
    return readBody(body => {
      const regs = loadData('registrations.json', []);
      const r = regs.find(r => r.id === rid);
      if (!r) return sendError('Not found', 404);
      r.status = 'approved'; r.updatedAt = nowISO();
      saveData('registrations.json', regs);
      return sendJSON({ success:true, registration:r });
    });
  }
  if (pathname.startsWith('/api/registrations/') && pathname.endsWith('/reset-password') && method === 'POST') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    const rid = pathname.split('/')[3];
    return readBody(body => {
      if (!body.password || body.password.length < 4) return sendError('Password must be at least 4 characters');
      const regs = loadData('registrations.json', []);
      const r = regs.find(r => r.id === rid);
      if (!r) return sendError('Not found', 404);
      r.password = body.password; r.updatedAt = nowISO();
      saveData('registrations.json', regs);
      return sendJSON({ success:true, registration:r });
    });
  }

  // ----- SELLER / DELIVERY LOGIN -----
  if (pathname === '/api/sd-login' && method === 'POST') {
    return readBody(body => {
      if (!body.mobile || !body.password || !body.role) return sendError('Missing fields');
      const regs = loadData('registrations.json', []);
      const reg = regs.find(r => r.mobile === body.mobile && r.role === body.role);
      if (!reg) return sendError('No account found. Check your details or register first.');
      if (reg.status === 'pending') return sendError('Your registration is pending admin approval. Please wait.');
      if (reg.status === 'rejected') return sendError('Your registration was rejected. Contact admin.');
      if (reg.status === 'blocked') return sendError('Your account is blocked. Contact admin.');
      if (!reg.password) return sendError('Admin has not set your password yet. Contact admin.');
      if (reg.password !== body.password) return sendError('Incorrect password');
      const token = createSession(reg.role, reg.id);
      return sendJSON({ success:true, token, user:{ id:reg.id, role:reg.role, name:reg.name, mobile:reg.mobile, city:reg.city, shop:reg.shop } });
    });
  }

  // ----- ADMIN LOGIN -----
  if (pathname === '/api/admin-login' && method === 'POST') {
    return readBody(body => {
      const s = loadData('settings.json', {});
      if (body.mobile !== s.adminMobile || body.password !== s.adminPassword) return sendError('Invalid admin credentials');
      const token = createSession('admin');
      return sendJSON({ success:true, token, user:{ id:'ADMIN', role:'admin', name:'Admin' } });
    });
  }

  // ----- ADMIN GET ALL DATA -----
  if (pathname === '/api/admin/data' && method === 'GET') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    return sendJSON({
      products: loadData('products.json', []),
      sellerProducts: loadData('sellerProducts.json', []),
      orders: loadData('orders.json', []),
      users: loadData('users.json', { customers:[] }),
      registrations: loadData('registrations.json', []),
      deliveryBoys: (loadData('registrations.json', [])).filter(r => r.role === 'delivery' && r.status === 'approved'),
      settings: (()=>{ const s=loadData('settings.json',{}); return { storeName:s.storeName, storeTagline:s.storeTagline, adminMobile:s.adminMobile, adminPassword:s.adminPassword, defaultDeliveryCharge:s.defaultDeliveryCharge }; })()
    });
  }

  // ----- CUSTOMERS (admin) -----
  if (pathname === '/api/admin/users' && method === 'GET') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    return sendJSON({ users: loadData('users.json', { customers:[] }).customers, orders: loadData('orders.json', []) });
  }
  if (pathname.startsWith('/api/admin/users/') && method === 'PUT') {
    const u = authUser();
    if (!u || u.role !== 'admin') return sendError('Admin only', 403);
    const uid = pathname.split('/')[4];
    return readBody(body => {
      const users = loadData('users.json', { customers:[] });
      const c = users.customers.find(c => c.id === uid);
      if (!c) return sendError('User not found', 404);
      if (body.status !== undefined) c.status = body.status;
      c.updatedAt = nowISO();
      saveData('users.json', users);
      return sendJSON({ success:true, customer:c });
    });
  }

  // ----- SESSION VERIFY -----
  if (pathname === '/api/session' && method === 'POST') {
    return readBody(body => {
      const u = userFromSession(getSession(body.token));
      if (!u) return sendError('Invalid session');
      return sendJSON({ success:true, user:u });
    });
  }

  // ----- LOGOUT -----
  if (pathname === '/api/logout' && method === 'POST') {
    return readBody(body => { destroySession(body.token); return sendJSON({ success:true }); });
  }

  return sendError('Endpoint not found: ' + method + ' ' + pathname, 404);
});

server.listen(PORT, '0.0.0.0', function() {
  console.log('AFROJ GLOBAL VENTURES server running on port ' + PORT);
  console.log('  App:  http://localhost:' + PORT);
  console.log('  API:  http://localhost:' + PORT + '/api/health');
});

process.on('uncaughtException', e => console.error('Uncaught:', e.message));
