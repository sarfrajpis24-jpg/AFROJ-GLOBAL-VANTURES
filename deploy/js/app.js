/* =========================================================
   AFROJ GLOBAL VENTURES - v6 (REST API Edition)
   ALL data comes from the server REST API (no DB cache).
   localStorage stores ONLY: session token + cart.
   Every phone -> same live data. No data loss, no disappearing.
   ========================================================= */

// ====== API LAYER ======
async function api(path, method, body) {
  const token = localStorage.getItem('agv_token') || '';
  const opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined && method && method !== 'GET') opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    throw new Error('Network error. Check your internet connection.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    const msg = (data && data.error) ? data.error : ('Request failed (' + res.status + ')');
    throw new Error(msg);
  }
  return data;
}

// ====== STATE ======
let SESSION = null;       // { token, user }
let CURRENT_ROUTE = 'landing';
let CART = [];
let ADMIN_POLL = null, SELLER_POLL = null, DELIVERY_POLL = null, HOME_POLL = null;
const POLL_INTERVAL = 15000;
let adminTab = 'dashboard';
let pendingMobile = null;

// Load session token + cart from localStorage (ONLY these two)
try { CART = JSON.parse(localStorage.getItem('agv_cart6') || '[]'); } catch(e) { CART = []; }

// ====== IMAGE COMPRESSION (client-side, before upload) ======
function compressImage(file, maxWidth, quality, callback) {
  if (!file) { callback(null); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const isSmall = (file.size < 100000);
      const dataUrl = canvas.toDataURL(isSmall ? 'image/png' : 'image/jpeg', quality || 0.7);
      callback(dataUrl);
    };
    img.onerror = function() { callback(null); };
    img.src = e.target.result;
  };
  reader.onerror = function() { callback(null); };
  reader.readAsDataURL(file);
}

// ====== UTILITIES ======
function $(id) { return document.getElementById(id); }
function fmtPrice(n) { return '\u20b9' + Number(n||0).toLocaleString('en-IN'); }
function saveCart() { try { localStorage.setItem('agv_cart6', JSON.stringify(CART)); } catch(e) {} }
function saveSession() { if (SESSION) { localStorage.setItem('agv_token', SESSION.token); localStorage.setItem('agv_user', JSON.stringify(SESSION.user)); } }
function clearSession() { SESSION = null; localStorage.removeItem('agv_token'); localStorage.removeItem('agv_user'); }
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function render(html) { $('screen').innerHTML = html; window.scrollTo(0,0); }
function genOTP() { return Math.floor(1000 + Math.random()*9000).toString(); }
function getDeliveryDate(order) {
  if (!order) return '';
  const days = order.deliveryDays || 3;
  const base = order.createdAt || order.expectedDelivery;
  const d = new Date(base);
  if (order.expectedDelivery) { return new Date(order.expectedDelivery).toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'}); }
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short' });
}
function stopAllPolls() {
  if (ADMIN_POLL) { clearInterval(ADMIN_POLL); ADMIN_POLL = null; }
  if (SELLER_POLL) { clearInterval(SELLER_POLL); SELLER_POLL = null; }
  if (DELIVERY_POLL) { clearInterval(DELIVERY_POLL); DELIVERY_POLL = null; }
  if (HOME_POLL) { clearInterval(HOME_POLL); HOME_POLL = null; }
}
function showLoader(msg) {
  render(`<div class="loader-screen" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:var(--bg);">
    <img src="favicon.svg" alt="AGV" style="width:80px;height:80px;margin-bottom:15px;" onerror="this.style.display='none'">
    <div style="font-size:20px;font-weight:bold;color:var(--gold);margin-bottom:20px;letter-spacing:2px;">AFROJ GLOBAL VENTURES</div>
    <div class="loader" style="margin:20px 0;"></div>
    <p style="color:#999;">${msg || 'Loading...'}</p>
  </div>`);
}
function apiError(e) {
  alert('Error: ' + (e.message || e));
}

// ====== BOTTOM NAV ======
function bottomNav(active) {
  const items = [
    { key:'home', label:'Home', icon:'\ud83c\udfe0' },
    { key:'orders', label:'Orders', icon:'\ud83d\udce6' },
    { key:'cart', label:'Cart', icon:'\ud83d\uded2' },
    { key:'profile', label:'Profile', icon:'\ud83d\udc64' }
  ];
  const buttons = items.map(i => `<button class="bn-item ${active===i.key?'active':''}" onclick="navTo('${i.key}')"><span class="bn-icon">${i.icon}</span><span class="bn-label">${i.label}</span></button>`).join('');
  return `<div class="bottom-nav">${buttons}</div>`;
}
function navTo(key) {
  if (key === 'home') renderCustomerHome();
  else if (key === 'orders') renderCustomerOrders();
  else if (key === 'cart') renderCart();
  else if (key === 'profile') renderProfile();
}

// ====== INIT ======
async function init() {
  showLoader('Loading...');
  const token = localStorage.getItem('agv_token');
  if (token) {
    try {
      const r = await api('/api/session', 'POST', { token });
      SESSION = { token, user: r.user };
      _routeAfterLoad();
      return;
    } catch(e) { clearSession(); }
  }
  renderLanding();
}

function _routeAfterLoad() {
  if (!SESSION || !SESSION.user) { renderLanding(); return; }
  const role = SESSION.user.role;
  if (role === 'admin') renderAdminDashboard();
  else if (role === 'seller') renderSellerPanel();
  else if (role === 'delivery') renderDeliveryPanel();
  else renderCustomerHome();
}

// ====== LANDING ======
function renderLanding() {
  CURRENT_ROUTE = 'landing';
  stopAllPolls();
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const showInstall = !isStandalone;
  render(`
    <div class="landing">
      <div class="landing-hero">
        <div class="landing-glow"></div>
        <div class="landing-logo-wrap">
          <img src="favicon.svg" alt="AGV Logo" class="landing-logo-img" onerror="this.style.display='none'">
          <div class="landing-logo">AFROJ GLOBAL</div>
          <div class="landing-logo-sub">VENTURES</div>
        </div>
        <p class="landing-tagline">Luxury Shopping, Delivered to You</p>
        <div class="landing-crown">\ud83d\udc51</div>
      </div>
      ${showInstall ? `<button id="pwa-install-btn" class="btn btn-install" onclick="installApp()">\ud83d\udcf2 Install App on Your Phone</button>` : ''}
      <div class="role-section">
        <div class="role-section-title">Choose Your Login</div>
        <button class="role-btn role-customer" onclick="renderCustomerLogin()">
          <span class="role-icon">\ud83d\udecd\ufe0f</span>
          <div class="role-text-wrap"><span class="role-text">Customer Login</span><span class="role-sub">Shop products & place orders</span></div>
          <span class="role-arrow">\u2192</span>
        </button>
        <div class="role-divider"><span>Partner Access</span></div>
        <div class="role-row">
          <button class="role-btn role-small" onclick="renderRegister()"><span class="role-icon">\ud83d\udcdd</span><span class="role-text">Register<br><small>Seller / Delivery</small></span></button>
          <button class="role-btn role-small" onclick="renderSDLogin()"><span class="role-icon">\ud83d\udd10</span><span class="role-text">Login<br><small>Seller / Delivery</small></span></button>
        </div>
        <button class="role-btn role-admin" onclick="renderAdminLogin()">
          <span class="role-icon">\u2699\ufe0f</span>
          <div class="role-text-wrap"><span class="role-text">Admin Panel</span><span class="role-sub">Manage everything</span></div>
          <span class="role-arrow">\u2192</span>
        </button>
      </div>
      <div class="landing-footer">
        <div class="footer-products"><span>\ud83d\udc5c</span> <span>\u231a</span> <span>\ud83d\udc54</span> <span>\ud83d\udc60</span> <span>\ud83d\udd76\ufe0f</span></div>
        <p>\u00a9 2026 AFROJ GLOBAL VENTURES. All rights reserved.</p>
        <p class="gold">Premium \u2022 Luxury \u2022 Delivered</p>
      </div>
    </div>
  `);
}

// ====== PRODUCT CARD ======
function productCard(p) {
  const img = (p.images && p.images[0]) ? p.images[0] : (p.image || '');
  const discount = p.mrp && p.mrp > p.price ? Math.round((1 - p.price/p.mrp)*100) : 0;
  return `<div class="product-card" onclick="renderProductDetail('${p.id}')">
    <div class="product-img" style="background-image:url('${esc(img)}')">${discount>0?`<span class="badge-corner">${discount}% off</span>`:''}</div>
    <div class="product-info">
      <div class="product-name">${esc(p.name)}</div>
      ${p.mrp && p.mrp > p.price ? `<div class="product-price">${fmtPrice(p.price)} <span class="mrp">${fmtPrice(p.mrp)}</span></div>` : `<div class="product-price">${fmtPrice(p.price)}</div>`}
      ${p.deliveryDays ? `<div class="delivery-eta">\ud83d\ude9a ${p.deliveryDays} days</div>` : ''}
      ${p.stock > 0 ? '<div class="product-stock">In Stock</div>' : '<div class="product-stock out">Out of Stock</div>'}
    </div>
  </div>`;
}

// ====== CUSTOMER LOGIN ======
let pendingOTP = null;

function renderCustomerLogin() {
  CURRENT_ROUTE = 'customerLogin';
  render(`
    <div class="app-header"><button class="back-btn" onclick="renderLanding()">\u2190</button><h2>Customer Login</h2></div>
    <div class="app-content">
      <div class="card card-gold">
        <div class="login-logo-center"><img src="favicon.svg" alt="AGV" style="width:60px;height:60px;" onerror="this.style.display='none'"></div>
        <h3 class="gold center">Welcome to AFROJ GLOBAL VENTURES</h3>
        <p class="small center" style="color:#999;margin-bottom:20px;">Login with your mobile number to start shopping</p>
        <div class="form-group"><label>Mobile Number</label><input type="tel" id="custMobile" placeholder="Enter 10-digit mobile number" maxlength="10" inputmode="numeric"></div>
        <button class="btn btn-gold btn-block" onclick="sendCustomerOTP()">Send OTP</button>
      </div>
    </div>
  `);
}

async function sendCustomerOTP() {
  const mobile = $('custMobile').value.trim();
  if (!/^\d{10}$/.test(mobile)) { alert('Please enter a valid 10-digit mobile number'); return; }
  showLoader('Sending OTP...');
  try {
    const r = await api('/api/customer/send-otp', 'POST', { phone: mobile });
    pendingMobile = mobile;
    // In SMS mode, OTP is NOT returned. In demo mode (or fallback), OTP is shown on screen.
    const isDemo = (r.mode === 'demo' || r.fallback === true);
    pendingOTP = isDemo ? r.otp : null;
    renderOTPVerifyScreen(mobile, r.message || (isDemo ? 'OTP sent (demo mode)' : 'OTP sent via SMS'), isDemo);
  } catch (e) {
    apiError(e); renderCustomerLogin();
  }
}

async function resendCustomerOTP() {
  if (!pendingMobile) { renderCustomerLogin(); return; }
  showLoader('Re-sending OTP...');
  try {
    const r = await api('/api/customer/resend-otp', 'POST', { phone: pendingMobile });
    const isDemo = (r.mode === 'demo' || r.fallback === true);
    pendingOTP = isDemo ? r.otp : null;
    renderOTPVerifyScreen(pendingMobile, r.message || (isDemo ? 'OTP re-sent (demo mode)' : 'OTP re-sent via SMS'), isDemo);
  } catch (e) {
    apiError(e);
  }
}

function renderOTPVerifyScreen(mobile, message, isDemo) {
  const demoHTML = isDemo
    ? `<div class="alert alert-info" style="margin-bottom:15px;">${message}<br><br>For demo: Your OTP is <strong style="font-size:24px;color:var(--gold);">${pendingOTP}</strong></div>`
    : `<div class="alert alert-info" style="margin-bottom:15px;">\ud83d\udcf1 OTP sent to <strong>+91 ${mobile}</strong> via SMS. Please check your phone messages and enter the 6-digit code below.</div>`;
  render(`
    <div class="app-header"><button class="back-btn" onclick="renderCustomerLogin()">\u2190</button><h2>Verify OTP</h2></div>
    <div class="app-content">
      <div class="card card-gold">
        ${demoHTML}
        <div class="form-group"><label>Enter OTP</label><input type="text" id="custOTP" placeholder="6-digit OTP" maxlength="6" inputmode="numeric" autofocus></div>
        <button class="btn btn-gold btn-block" onclick="verifyCustomerOTP()">Verify & Login</button>
        <button class="btn btn-outline btn-block" style="margin-top:10px;" onclick="resendCustomerOTP()">\ud83d\udd04 Resend OTP</button>
        <button class="btn btn-outline btn-block" style="margin-top:10px;" onclick="renderCustomerLogin()">Change Number</button>
      </div>
    </div>
  `);
}

async function verifyCustomerOTP() {
  const otp = $('custOTP').value.trim();
  if (!otp) { alert('Enter OTP'); return; }
  showLoader('Logging in...');
  try {
    const r = await api('/api/customer/verify-otp', 'POST', { phone: pendingMobile, otp: otp });
    SESSION = { token: r.token, user: Object.assign({}, r.customer, { role:'customer' }) };
    saveSession();
    pendingOTP = null; pendingMobile = null;
    renderCustomerHome();
  } catch (e) {
    apiError(e); renderCustomerLogin();
  }
}

// ====== CUSTOMER HOME ======
let lastHomeProducts = '';

async function renderCustomerHome() {
  if (!SESSION || SESSION.user.role !== 'customer') { renderCustomerLogin(); return; }
  CURRENT_ROUTE = 'home';
  showLoader('Loading products...');
  try {
    const r = await api('/api/products');
    const products = r.products || [];
    const cartCount = CART.reduce((s,i)=>s+i.qty,0);
    lastHomeProducts = JSON.stringify(products.map(p=>p.id+p.name+p.price+p.status));
    render(`
      <div class="app-header">
        <div class="header-logo gold">AFROJ GLOBAL VENTURES</div>
        <div style="display:flex;align-items:center;gap:12px;">
          <button class="header-refresh" onclick="renderCustomerHome()" title="Refresh">\ud83d\udd04</button>
          <div class="header-cart-badge" onclick="renderCart()">\ud83d\uded2 ${cartCount}</div>
        </div>
      </div>
      <div class="app-content" style="padding-bottom:70px;">
        <div class="welcome"><p>Hello, ${esc(SESSION.user.name || 'Customer')}! \ud83d\udc4b</p></div>
        <h3 class="section-title">All Products (${products.length})</h3>
        ${products.length === 0 ? '<div class="empty">No products available yet</div>' : `<div class="product-grid">${products.map(productCard).join('')}</div>`}
      </div>
      ${bottomNav('home')}
    `);
    // light polling for new products across devices
    if (HOME_POLL) clearInterval(HOME_POLL);
    HOME_POLL = setInterval(async () => {
      if (CURRENT_ROUTE !== 'home') return;
      try {
        const rr = await api('/api/products');
        const sig = JSON.stringify((rr.products||[]).map(p=>p.id+p.name+p.price+p.status));
        if (sig !== lastHomeProducts) renderCustomerHome();
      } catch(e) {}
    }, POLL_INTERVAL);
  } catch (e) {
    apiError(e);
  }
}

// ====== PRODUCT DETAIL ======
async function renderProductDetail(pid) {
  showLoader('Loading product...');
  try {
    const r = await api('/api/products');
    const product = (r.products || []).find(p => p.id === pid);
    if (!product) { alert('Product not found'); renderCustomerHome(); return; }
    const images = product.images || (product.image ? [product.image] : []);
    const mainImg = images[0] || '';
    const deliveryDays = product.deliveryDays || 3;
    const etaDate = new Date(); etaDate.setDate(etaDate.getDate() + deliveryDays);
    const etaStr = etaDate.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
    const discount = product.mrp && product.mrp > product.price ? Math.round((1 - product.price/product.mrp)*100) : 0;
    render(`
      <div class="app-header"><button class="back-btn" onclick="renderCustomerHome()">\u2190</button><h2>Product</h2></div>
      <div class="app-content" style="padding-bottom:80px;">
        <div class="gallery">
          <div class="gallery-main" id="galleryMain" style="background-image:url('${esc(mainImg)}')"></div>
          ${images.length > 1 ? `<div class="gallery-thumbs">${images.map((img,i)=>`<div class="gallery-thumb ${i===0?'active':''}" onclick="changeGalleryImage(this,'${esc(img)}')" style="background-image:url('${esc(img)}')"></div>`).join('')}</div>` : ''}
        </div>
        <div class="pd-info">
          <div class="pd-name">${esc(product.name)}</div>
          <div class="pd-category">${esc(product.category || '')}</div>
          ${discount > 0 ? `<div class="pd-price">${fmtPrice(product.price)} <span class="mrp" style="text-decoration:line-through;color:#888;font-size:16px;">${fmtPrice(product.mrp)}</span> <span class="gold" style="font-size:14px;">${discount}% off</span></div>` : `<div class="pd-price">${fmtPrice(product.price)}</div>`}
          <div class="pd-delivery-eta">\ud83d\ude9a Delivery by <strong class="gold">${etaStr}</strong> (${deliveryDays} days)</div>
          <div class="pd-meta">${product.deliveryCharge > 0 ? `Delivery Charge: ${fmtPrice(product.deliveryCharge)}` : '<span class="gold">FREE Delivery</span>'}</div>
          <div class="pd-stock">${product.stock > 0 ? `<span style="color:#4CAF50;">\u2713 In Stock (${product.stock} available)</span>` : '<span style="color:#f44336;">Out of Stock</span>'}</div>
          <div class="pd-desc"><h4>Description</h4><p>${esc(product.description || '')}</p></div>
          ${product.stock > 0 ? `
            <button class="btn btn-gold btn-block" onclick="addToCart('${product.id}')">Add to Cart \ud83d\uded2</button>
            <button class="btn btn-outline btn-block" style="margin-top:10px;" onclick="buyNow('${product.id}')">Buy Now \u26a1</button>
          ` : '<div class="alert alert-error">Currently out of stock</div>'}
        </div>
      </div>
    `);
  } catch (e) { apiError(e); }
}

function changeGalleryImage(thumb, url) {
  document.querySelectorAll('.gallery-thumb').forEach(t => t.classList.remove('active'));
  thumb.classList.add('active');
  $('galleryMain').style.backgroundImage = `url('${url}')`;
}

async function addToCart(pid) {
  try {
    const r = await api('/api/products');
    const product = (r.products || []).find(p => p.id === pid);
    if (!product) return;
    const existing = CART.find(i => i.id === pid);
    if (existing) { existing.qty++; }
    else {
      const img = (product.images && product.images[0]) ? product.images[0] : product.image;
      CART.push({ id:pid, name:product.name, price:product.price, image:img, deliveryCharge:product.deliveryCharge||0, deliveryDays:product.deliveryDays||3, sellerProductId:product.sellerProductId, qty:1 });
    }
    saveCart();
    alert('Added to cart!');
  } catch(e) { apiError(e); }
}

function buyNow(pid) { addToCart(pid).then(() => renderCart()); }

// ====== CART ======
function renderCart() {
  if (!SESSION || SESSION.user.role !== 'customer') { renderCustomerLogin(); return; }
  CURRENT_ROUTE = 'cart';
  if (CART.length === 0) {
    render(`<div class="app-header"><button class="back-btn" onclick="renderCustomerHome()">\u2190</button><h2>Cart</h2></div>
      <div class="app-content"><div class="empty">\ud83d\uded2 Your cart is empty</div><button class="btn btn-gold btn-block" onclick="renderCustomerHome()">Start Shopping</button></div>${bottomNav('cart')}`);
    return;
  }
  const subtotal = CART.reduce((s,i)=>s+(i.price*i.qty),0);
  const delivery = CART.reduce((s,i)=>s+((i.deliveryCharge||0)*i.qty),0);
  const total = subtotal + delivery;
  const maxDays = Math.max.apply(null, CART.map(i=>i.deliveryDays||3));
  const etaDate = new Date(); etaDate.setDate(etaDate.getDate()+maxDays);
  const etaStr = etaDate.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
  render(`
    <div class="app-header"><button class="back-btn" onclick="renderCustomerHome()">\u2190</button><h2>Cart (${CART.reduce((s,i)=>s+i.qty,0)})</h2></div>
    <div class="app-content" style="padding-bottom:70px;">
      ${CART.map((item,i)=>`
        <div class="cart-item">
          <div class="cart-img" style="background-image:url('${esc(item.image||'')}')"></div>
          <div class="cart-details">
            <div class="cart-name">${esc(item.name)}</div>
            <div class="cart-price">${fmtPrice(item.price)}</div>
            <div class="qty-control"><button onclick="changeQty(${i},-1)">\u2212</button><span>${item.qty}</span><button onclick="changeQty(${i},1)">+</button></div>
          </div>
          <div class="cart-remove" onclick="removeFromCart(${i})">\u2715</div>
        </div>
      `).join('')}
      <div class="delivery-eta-box">\ud83d\ude9a Delivery by <strong class="gold">${etaStr}</strong></div>
      <div class="summary-box">
        <div class="summary-row"><span>Subtotal</span><span>${fmtPrice(subtotal)}</span></div>
        <div class="summary-row"><span>Delivery</span><span>${fmtPrice(delivery)}</span></div>
        <div class="summary-row total"><span>Total</span><span>${fmtPrice(total)}</span></div>
      </div>
      <button class="btn btn-gold btn-block" style="margin-top:15px;" onclick="renderCheckout()">Proceed to Checkout \u2192</button>
    </div>
    ${bottomNav('cart')}
  `);
}

function changeQty(index, delta) {
  CART[index].qty += delta;
  if (CART[index].qty <= 0) CART.splice(index, 1);
  saveCart(); renderCart();
}
function removeFromCart(index) { CART.splice(index,1); saveCart(); renderCart(); }

// ====== CHECKOUT ======
function renderCheckout() {
  if (CART.length === 0) { renderCart(); return; }
  const u = SESSION.user;
  const subtotal = CART.reduce((s,i)=>s+(i.price*i.qty),0);
  const delivery = CART.reduce((s,i)=>s+((i.deliveryCharge||0)*i.qty),0);
  const total = subtotal + delivery;
  const maxDays = Math.max.apply(null, CART.map(i=>i.deliveryDays||3));
  const etaDate = new Date(); etaDate.setDate(etaDate.getDate()+maxDays);
  const etaStr = etaDate.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
  render(`
    <div class="app-header"><button class="back-btn" onclick="renderCart()">\u2190</button><h2>Checkout</h2></div>
    <div class="app-content" style="padding-bottom:80px;">
      <div class="card">
        <h3 class="gold">Delivery Details</h3>
        <div class="form-group"><label>Full Name *</label><input type="text" id="delName" value="${esc(u.name||'')}" placeholder="Your name"></div>
        <div class="form-group"><label>Mobile Number</label><input type="tel" value="+91 ${u.mobile}" disabled></div>
        <div class="form-group"><label>Full Address *</label><textarea id="delAddress" rows="3" placeholder="House no, Street, Area, City, Pincode">${esc(u.address||'')}</textarea></div>
        <div class="form-group"><label>City *</label><input type="text" id="delCity" value="${esc(u.city||'')}" placeholder="City"></div>
        <div class="form-group"><label>Pincode *</label><input type="text" id="delPincode" value="${esc(u.pincode||'')}" placeholder="6-digit pincode" maxlength="6" inputmode="numeric"></div>
      </div>
      <div class="delivery-eta-box">\ud83d\ude9a Expected Delivery: <strong class="gold">${etaStr}</strong></div>
      <div class="summary-box">
        <h4>Order Summary</h4>
        ${CART.map(i=>`<div class="summary-row"><span>${esc(i.name)} \u00d7 ${i.qty}</span><span>${fmtPrice(i.price*i.qty)}</span></div>`).join('')}
        <hr style="border-color:#333;margin:10px 0;">
        <div class="summary-row"><span>Subtotal</span><span>${fmtPrice(subtotal)}</span></div>
        <div class="summary-row"><span>Delivery</span><span>${fmtPrice(delivery)}</span></div>
        <div class="summary-row total"><span>Total</span><span>${fmtPrice(total)}</span></div>
      </div>
      <div class="payment-box"><p class="small" style="color:#999;">\ud83d\udcb3 Payment: <strong class="gold">Cash on Delivery</strong></p><p class="small" style="color:#666;">Pay when your order arrives</p></div>
      <button class="btn btn-gold btn-block" onclick="placeOrder()">Place Order \ud83c\udf89</button>
    </div>
  `);
}

async function placeOrder() {
  const name = $('delName').value.trim();
  const address = $('delAddress').value.trim();
  const city = $('delCity').value.trim();
  const pincode = $('delPincode').value.trim();
  if (!name || !address || !city || !pincode) { alert('Please fill all required fields'); return; }
  if (!/^\d{6}$/.test(pincode)) { alert('Please enter a valid 6-digit pincode'); return; }
  showLoader('Placing your order...');
  try {
    const subtotal = CART.reduce((s,i)=>s+(i.price*i.qty),0);
    const delivery = CART.reduce((s,i)=>s+((i.deliveryCharge||0)*i.qty),0);
    const total = subtotal + delivery;
    const items = CART.map(i => ({ id:i.id, name:i.name, price:i.price, qty:i.qty, image:i.image, deliveryCharge:i.deliveryCharge||0, deliveryDays:i.deliveryDays||3, sellerProductId:i.sellerProductId }));
    const r = await api('/api/orders','POST', { items, customerName:name, address, city, pincode, subtotal, delivery, total });
    const order = r.order;
    CART = []; saveCart();
    // refresh local user info
    SESSION.user.name = name; SESSION.user.address = address; SESSION.user.city = city; SESSION.user.pincode = pincode;
    saveSession();
    const etaStr = getDeliveryDate(order);
    render(`
      <div class="success-screen">
        <div class="success-icon">\u2705</div>
        <h2 class="gold">Order Placed Successfully!</h2>
        <p>Order ID: <strong>${order.id}</strong></p>
        <div class="delivery-eta-box" style="margin:15px 0;">\ud83d\ude9a Expected Delivery: <strong class="gold">${etaStr}</strong></div>
        <p style="color:#999;margin:10px 0;">Your order has been placed and is now awaiting admin confirmation.</p>
        <div class="summary-box" style="margin:20px 0;">
          <div class="summary-row total"><span>Total Amount</span><span>${fmtPrice(order.total)}</span></div>
          <div class="summary-row"><span>Payment</span><span>Cash on Delivery</span></div>
        </div>
        <button class="btn btn-gold btn-block" onclick="renderOrderDetail('${order.id}')">Track My Order</button>
        <button class="btn btn-outline btn-block" style="margin-top:10px;" onclick="renderCustomerHome()">Continue Shopping</button>
      </div>
    `);
  } catch (e) { apiError(e); }
}

// ====== CUSTOMER ORDERS ======
async function renderCustomerOrders() {
  if (!SESSION || SESSION.user.role !== 'customer') { renderCustomerLogin(); return; }
  CURRENT_ROUTE = 'orders';
  showLoader('Loading your orders...');
  try {
    const r = await api('/api/orders/customer');
    const orders = r.orders || [];
    render(`
      <div class="app-header"><h2>My Orders</h2><button class="header-refresh" onclick="renderCustomerOrders()" title="Refresh">\ud83d\udd04</button></div>
      <div class="app-content" style="padding-bottom:70px;">
        ${orders.length === 0 ? '<div class="empty">\ud83d\udce6 No orders yet. Start shopping!</div>' : orders.map(orderCard).join('')}
      </div>
      ${bottomNav('orders')}
    `);
  } catch (e) { apiError(e); }
}

function orderCard(o) {
  const statusColors = {
    'Awaiting Admin':'badge-awaitingadmin','Seller Approval':'badge-pending','Admin Accepted':'badge-confirmed',
    'Awaiting Delivery':'badge-awaitingdelivery','Shipped':'badge-confirmed','Out for Delivery':'badge-outfordelivery',
    'Delivered':'badge-delivered','Cancelled':'badge-cancelled','Customer Cancelled':'badge-cancelled'
  };
  const img = (o.items[0] && o.items[0].image) ? o.items[0].image : '';
  return `<div class="card order-card" onclick="renderOrderDetail('${o.id}')">
    <div class="order-header">
      <div><div class="order-id">${o.id}</div><div class="order-date">${new Date(o.createdAt).toLocaleString('en-IN')}</div></div>
      <span class="badge badge-status ${statusColors[o.status]||'badge-pending'}">${o.status}</span>
    </div>
    ${img ? `<div class="order-item-img" style="background-image:url('${esc(img)}')"></div>` : ''}
    <div class="order-items">${o.items.map(i=>`<div class="order-item-row"><span>${esc(i.name)} \u00d7 ${i.qty}</span><span>${fmtPrice(i.price*i.qty)}</span></div>`).join('')}</div>
    ${o.status!=='Delivered'&&o.status!=='Cancelled'&&o.status!=='Customer Cancelled' ? `<div class="order-eta">\ud83d\ude9a Delivery by ${getDeliveryDate(o)}</div>` : ''}
    <div class="order-total"><span>Total: <strong class="gold">${fmtPrice(o.total)}</strong></span><span class="small">COD</span></div>
  </div>`;
}

// ====== ORDER DETAIL ======
async function renderOrderDetail(oid) {
  showLoader('Loading order details...');
  try {
    const r = await api('/api/orders/customer');
    const o = (r.orders || []).find(x => x.id === oid);
    if (!o) { alert('Order not found'); renderCustomerOrders(); return; }
    const isCancellable = !['Delivered','Cancelled','Customer Cancelled','Out for Delivery','Shipped'].includes(o.status);
    const badgeClass = o.status==='Delivered'?'badge-delivered':(['Cancelled','Customer Cancelled'].includes(o.status))?'badge-cancelled':o.status==='Out for Delivery'?'badge-outfordelivery':o.status==='Shipped'?'badge-confirmed':o.status==='Awaiting Delivery'?'badge-awaitingdelivery':'badge-pending';
    render(`
      <div class="app-header"><button class="back-btn" onclick="renderCustomerOrders()">\u2190</button><h2>Order Details</h2></div>
      <div class="app-content">
        <div class="card">
          <div class="order-id gold">Order ${o.id}</div>
          <div class="order-date">${new Date(o.createdAt).toLocaleString('en-IN')}</div>
          <div style="margin:15px 0;"><span class="badge badge-status ${badgeClass}">${o.status}</span>${o.cancelledBy?`<div class="small" style="color:#f44336;margin-top:5px;">Cancelled by: ${esc(o.cancelledBy)}</div>`:''}</div>
          ${!['Delivered','Cancelled','Customer Cancelled'].includes(o.status) ? `<div class="delivery-eta-box">\ud83d\ude9a Expected Delivery: <strong class="gold">${getDeliveryDate(o)}</strong></div>` : ''}
          <h4>\ud83d\udcca Order Tracking</h4>
          <div class="tracking">
            ${(o.statusHistory||[]).map((h,idx)=>{
              const isLast = idx === (o.statusHistory||[]).length-1;
              const isCancelled = ['Cancelled','Customer Cancelled','Rejected by Admin','Rejected by Seller'].includes(h.status);
              return `<div class="tracking-step"><div class="tracking-dot ${isLast?(isCancelled?'cancelled':'active'):'done'}"></div><div class="tracking-info"><div class="tracking-status ${isCancelled?'text-red':''}">${h.status}</div><div class="tracking-time">${new Date(h.time).toLocaleString('en-IN')}</div>${h.by?`<div class="small" style="color:#666;">by ${esc(h.by)}</div>`:''}</div></div>`;
            }).join('')}
          </div>
        </div>
        <div class="card">
          <h4>\ud83d\udce6 Items</h4>
          ${o.items.map(i=>{ const img=i.image||''; return `<div class="order-item-detail">${img?`<div class="order-item-img" style="background-image:url('${esc(img)}')"></div>`:''}<div style="flex:1;"><div>${esc(i.name)} \u00d7 ${i.qty}</div><div class="gold">${fmtPrice(i.price*i.qty)}</div></div></div>`; }).join('')}
          <div class="summary-box" style="margin-top:15px;">
            <div class="summary-row"><span>Subtotal</span><span>${fmtPrice(o.subtotal)}</span></div>
            <div class="summary-row"><span>Delivery</span><span>${fmtPrice(o.delivery)}</span></div>
            <div class="summary-row total"><span>Total</span><span>${fmtPrice(o.total)}</span></div>
          </div>
        </div>
        <div class="card"><h4>\ud83d\udccd Delivery Address</h4><p>${esc(o.customer.name)}<br>${esc(o.customer.address)}<br>${esc(o.customer.city||'')} ${o.customer.pincode?'- '+esc(o.customer.pincode):''}<br>Mobile: +91 ${o.customer.mobile}</p></div>
        ${o.assignedDelivery ? `<div class="card"><h4>\ud83d\ude9a Delivery Boy</h4><p>Assigned: ${esc(o.deliveryName || o.assignedDelivery)}</p></div>` : ''}
        <div style="margin-top:15px;">
          ${isCancellable ? `<button class="btn btn-outline btn-block" style="color:#f44336;border-color:#f44336;" onclick="cancelOrder('${o.id}')">Cancel Order</button>` : ''}
          ${o.status==='Delivered' ? '<div class="alert alert-success" style="margin-top:10px;">\u2705 Order Delivered Successfully!</div>' : ''}
          ${['Cancelled','Customer Cancelled'].includes(o.status) ? '<div class="alert alert-error" style="margin-top:10px;">\u274c Order Cancelled</div>' : ''}
        </div>
      </div>
    `);
  } catch (e) { apiError(e); }
}

async function cancelOrder(oid) {
  if (!confirm('Are you sure you want to cancel this order?')) return;
  showLoader('Cancelling order...');
  try {
    await api('/api/orders/'+oid+'/cancel','POST', {});
    renderOrderDetail(oid);
  } catch (e) { apiError(e); }
}

// ====== CUSTOMER PROFILE ======
async function renderProfile() {
  if (!SESSION || SESSION.user.role !== 'customer') { renderCustomerLogin(); return; }
  CURRENT_ROUTE = 'profile';
  showLoader('Loading profile...');
  try {
    const r = await api('/api/orders/customer');
    const orders = r.orders || [];
    const u = SESSION.user;
    const delivered = orders.filter(o=>o.status==='Delivered').length;
    const pending = orders.filter(o=>!['Delivered','Cancelled','Customer Cancelled'].includes(o.status)).length;
    render(`
      <div class="app-header"><h2>My Profile</h2></div>
      <div class="app-content" style="padding-bottom:70px;">
        <div class="card card-gold" style="text-align:center;">
          <div class="profile-avatar">\ud83d\udc64</div>
          <h3 class="gold">${esc(u.name || 'Customer')}</h3>
          <p style="color:#999;">+91 ${u.mobile}</p>
          ${u.status==='blocked' ? '<div class="alert alert-error">Account Blocked</div>' : '<span class="badge badge-approved">Active</span>'}
        </div>
        <div class="stats-grid" style="grid-template-columns:1fr 1fr 1fr;">
          <div class="stat-card"><div class="stat-num gold">${orders.length}</div><div class="stat-label">Total Orders</div></div>
          <div class="stat-card"><div class="stat-num gold">${delivered}</div><div class="stat-label">Delivered</div></div>
          <div class="stat-card"><div class="stat-num gold">${pending}</div><div class="stat-label">Pending</div></div>
        </div>
        <div class="card">
          <h4 class="gold">\ud83d\udccd Saved Address</h4>
          ${u.address ? `<p>${esc(u.name||'')}<br>${esc(u.address)}<br>${esc(u.city||'')} - ${esc(u.pincode||'')}<br>Mobile: +91 ${u.mobile}</p><button class="btn btn-outline btn-sm" onclick="renderEditProfile()">Edit Address</button>` : '<p style="color:#999;">No address saved yet. Add one during checkout.</p>'}
        </div>
        <div class="card">
          <h4 class="gold">\ud83d\udce6 Recent Orders</h4>
          ${orders.length === 0 ? '<p style="color:#999;">No orders yet</p>' : orders.slice(0,3).map(o=>`<div class="profile-order-row" onclick="renderOrderDetail('${o.id}')" style="padding:10px 0;border-bottom:1px solid #222;cursor:pointer;"><div style="display:flex;justify-content:space-between;"><span class="small">${o.id}</span><span class="badge badge-status ${o.status==='Delivered'?'badge-delivered':['Cancelled','Customer Cancelled'].includes(o.status)?'badge-cancelled':'badge-pending'}" style="font-size:10px;">${o.status}</span></div><div class="small" style="color:#999;">${fmtPrice(o.total)} \u2022 ${new Date(o.createdAt).toLocaleDateString('en-IN')}</div></div>`).join('')}
        </div>
        <div class="card"><h4 class="gold">\u2699\ufe0f Settings</h4><button class="btn btn-outline btn-block" onclick="logout()" style="color:#f44336;border-color:#f44336;">Logout</button></div>
      </div>
      ${bottomNav('profile')}
    `);
  } catch (e) { apiError(e); }
}

function renderEditProfile() {
  const u = SESSION.user;
  render(`
    <div class="app-header"><button class="back-btn" onclick="renderProfile()">\u2190</button><h2>Edit Profile</h2></div>
    <div class="app-content">
      <div class="card">
        <div class="form-group"><label>Full Name</label><input type="text" id="profName" value="${esc(u.name||'')}"></div>
        <div class="form-group"><label>Address</label><textarea id="profAddress" rows="3">${esc(u.address||'')}</textarea></div>
        <div class="form-group"><label>City</label><input type="text" id="profCity" value="${esc(u.city||'')}"></div>
        <div class="form-group"><label>Pincode</label><input type="text" id="profPincode" value="${esc(u.pincode||'')}" maxlength="6"></div>
        <button class="btn btn-gold btn-block" onclick="saveProfile()">Save Changes</button>
      </div>
    </div>
  `);
}

async function saveProfile() {
  showLoader('Saving...');
  try {
    const body = { name:$('profName').value.trim(), address:$('profAddress').value.trim(), city:$('profCity').value.trim(), pincode:$('profPincode').value.trim() };
    const r = await api('/api/customer/update','POST', body);
    SESSION.user = Object.assign({}, SESSION.user, r.customer, { role:'customer' });
    saveSession();
    renderProfile();
  } catch (e) { apiError(e); }
}

function logout() {
  if (!confirm('Are you sure you want to logout?')) return;
  try { api('/api/logout','POST', { token: SESSION ? SESSION.token : '' }); } catch(e) {}
  clearSession();
  CART = []; saveCart();
  stopAllPolls();
  renderLanding();
}

// ====== REGISTRATION ======
let regFiles = { aadharPhoto:'', photo:'' };

function renderRegister() {
  CURRENT_ROUTE = 'register';
  regFiles = { aadharPhoto:'', photo:'' };
  render(`
    <div class="app-header"><button class="back-btn" onclick="renderLanding()">\u2190</button><h2>Registration</h2></div>
    <div class="app-content">
      <div class="card">
        <h3 class="gold">Register as Seller or Delivery Boy</h3>
        <p class="small" style="color:#999;">Fill the form below. Admin will review and approve your registration, and set your password.</p>
        <div class="form-group"><label>Register As *</label><select id="regRole"><option value="seller">Seller (Add products to sell)</option><option value="delivery">Delivery Boy (Deliver orders)</option></select></div>
        <div class="form-group"><label>Full Name *</label><input type="text" id="regName" placeholder="Your full name"></div>
        <div class="form-group"><label>Mobile Number *</label><input type="tel" id="regMobile" placeholder="10-digit mobile" maxlength="10" inputmode="numeric"></div>
        <div class="form-group"><label>City *</label><input type="text" id="regCity" placeholder="Your city"></div>
        <div class="form-group"><label>Shop Name (for seller)</label><input type="text" id="regShop" placeholder="Your shop name (optional)"></div>
        <div class="form-group"><label>Aadhar Card Number *</label><input type="text" id="regAadhar" placeholder="12-digit Aadhar number" maxlength="12" inputmode="numeric"></div>
        <div class="form-group"><label>Aadhar Card Photo *</label>
          <div class="file-upload" onclick="document.getElementById('regAadharPhoto').click()"><div class="upload-icon">\ud83d\udcf7</div><p>Click to upload Aadhar photo</p><input type="file" id="regAadharPhoto" accept="image/*" style="display:none;" onchange="previewRegFile(this,'aadharPreview')"></div>
          <div id="aadharPreview" class="upload-preview"></div>
        </div>
        <div class="form-group"><label>Your Photo *</label>
          <div class="file-upload" onclick="document.getElementById('regPhoto').click()"><div class="upload-icon">\ud83e\udd33</div><p>Click to upload your photo</p><input type="file" id="regPhoto" accept="image/*" style="display:none;" onchange="previewRegFile(this,'photoPreview')"></div>
          <div id="photoPreview" class="upload-preview"></div>
        </div>
        <button class="btn btn-gold btn-block" onclick="submitRegistration()">Submit Registration</button>
      </div>
    </div>
  `);
}

function previewRegFile(input, previewId) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5*1024*1024) { alert('Image too large (max 5MB).'); input.value=''; return; }
  compressImage(file, 600, 0.6, function(dataUrl) {
    if (!dataUrl) { alert('Could not process image.'); return; }
    $(previewId).innerHTML = `<div class="preview-item"><img src="${dataUrl}" style="width:100%;border-radius:8px;"><button class="btn btn-sm" onclick="removePreview('${previewId}','${input.id}')">Remove</button></div>`;
    if (previewId === 'aadharPreview') regFiles.aadharPhoto = dataUrl;
    if (previewId === 'photoPreview') regFiles.photo = dataUrl;
  });
}
function removePreview(previewId, inputId) {
  $(previewId).innerHTML = '';
  if (previewId === 'aadharPreview') regFiles.aadharPhoto = '';
  if (previewId === 'photoPreview') regFiles.photo = '';
  document.getElementById(inputId).value = '';
}

async function submitRegistration() {
  const role = $('regRole').value;
  const name = $('regName').value.trim();
  const mobile = $('regMobile').value.trim();
  const city = $('regCity').value.trim();
  const shop = $('regShop').value.trim();
  const aadhar = $('regAadhar').value.trim();
  if (!name || !mobile || !city || !aadhar) { alert('Please fill all required fields'); return; }
  if (!/^\d{10}$/.test(mobile)) { alert('Invalid mobile number'); return; }
  if (!/^\d{12}$/.test(aadhar)) { alert('Invalid Aadhar number (12 digits)'); return; }
  if (!regFiles.aadharPhoto || !regFiles.photo) { alert('Please upload both photos'); return; }
  showLoader('Submitting registration...');
  try {
    const r = await api('/api/registrations','POST', { role, name, mobile, city, shop, aadhar, aadharPhoto:regFiles.aadharPhoto, photo:regFiles.photo });
    regFiles = { aadharPhoto:'', photo:'' };
    render(`
      <div class="success-screen">
        <div class="success-icon">\u2705</div>
        <h2 class="gold">Registration Submitted!</h2>
        <p style="color:#999;margin:10px 0;">Your registration for ${role==='seller'?'Seller':'Delivery Boy'} has been submitted. Admin will review and approve it, then set your password.</p>
        <p class="small">Registration ID: ${r.registration.id}</p>
        <button class="btn btn-gold btn-block" onclick="renderLanding()">Back to Home</button>
      </div>
    `);
  } catch (e) { apiError(e); }
}

// ====== SELLER / DELIVERY LOGIN ======
function renderSDLogin() {
  CURRENT_ROUTE = 'sdLogin';
  render(`
    <div class="app-header"><button class="back-btn" onclick="renderLanding()">\u2190</button><h2>Seller / Delivery Login</h2></div>
    <div class="app-content">
      <div class="card">
        <h3 class="gold">Login</h3>
        <div class="form-group"><label>Role</label><select id="sdRole"><option value="seller">Seller</option><option value="delivery">Delivery Boy</option></select></div>
        <div class="form-group"><label>Mobile Number</label><input type="tel" id="sdMobile" placeholder="10-digit mobile" maxlength="10" inputmode="numeric"></div>
        <div class="form-group"><label>Password</label><input type="password" id="sdPassword" placeholder="Your password (set by admin)"></div>
        <button class="btn btn-gold btn-block" onclick="sdLogin()">Login</button>
        <p class="small center" style="margin-top:15px;color:#999;">Not registered? <a href="#" onclick="renderRegister();return false;" class="gold">Register here</a></p>
        <p class="small center" style="color:#666;">Password is set by admin after approval.</p>
      </div>
    </div>
  `);
}

async function sdLogin() {
  const role = $('sdRole').value;
  const mobile = $('sdMobile').value.trim();
  const password = $('sdPassword').value;
  if (!mobile || !password) { alert('Please fill all fields'); return; }
  showLoader('Logging in...');
  try {
    const r = await api('/api/sd-login','POST', { role, mobile, password });
    SESSION = { token: r.token, user: r.user };
    saveSession();
    if (role === 'seller') renderSellerPanel(); else renderDeliveryPanel();
  } catch (e) { apiError(e); }
}

// ====== SELLER PANEL ======
async function renderSellerPanel() {
  if (!SESSION || SESSION.user.role !== 'seller') { renderSDLogin(); return; }
  CURRENT_ROUTE = 'seller';
  stopAllPolls();
  showLoader('Loading seller panel...');
  try {
    const [sp, ord] = await Promise.all([api('/api/seller-products'), api('/api/seller/orders')]);
    const myProducts = sp.sellerProducts || [];
    const myOrders = ord.orders || [];
    const approved = myProducts.filter(p=>p.status==='approved').length;
    const pending = myProducts.filter(p=>p.status==='pending').length;
    const myProductIds = myProducts.map(p=>p.id);
    const sellerApprovalOrders = myOrders.filter(o=>o.status==='Seller Approval');
    render(`
      <div class="app-header"><div class="header-logo gold">Seller Panel</div><button class="back-btn" onclick="logout()" style="position:relative;">Logout</button></div>
      <div class="app-content" style="padding-bottom:20px;">
        <div class="welcome"><p>Welcome, ${esc(SESSION.user.name||'Seller')}! \ud83c\udfea</p></div>
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-num gold">${myProducts.length}</div><div class="stat-label">Total Products</div></div>
          <div class="stat-card"><div class="stat-num gold">${approved}</div><div class="stat-label">Approved</div></div>
          <div class="stat-card"><div class="stat-num gold">${pending}</div><div class="stat-label">Pending</div></div>
          <div class="stat-card"><div class="stat-num gold">${sellerApprovalOrders.length}</div><div class="stat-label">Orders to Approve</div></div>
        </div>
        <button class="btn btn-gold btn-block" onclick="renderSellerAddProduct()">\u2795 Add New Product</button>
        <h3 class="section-title">My Products</h3>
        ${myProducts.length === 0 ? '<div class="empty">No products added yet. Click "Add New Product" to start selling!</div>' :
          myProducts.map(p => {
            const img = (p.images && p.images[0]) ? p.images[0] : (p.image||'');
            return `<div class="card">
              <div style="display:flex;gap:10px;">
                <div class="product-img" style="width:80px;height:80px;flex-shrink:0;background-image:url('${esc(img)}')"></div>
                <div style="flex:1;">
                  <div class="product-name">${esc(p.name)}</div>
                  <div class="product-price">${fmtPrice(p.price)}</div>
                  ${p.deliveryDays ? `<div class="small" style="color:#999;">\ud83d\ude9a ${p.deliveryDays} days delivery</div>` : ''}
                  <span class="badge ${p.status==='approved'?'badge-approved':p.status==='rejected'?'badge-rejected':'badge-pending'}">${p.status}</span>
                  <div style="margin-top:8px;">
                    <button class="btn btn-sm btn-outline" onclick="renderSellerEditProduct('${p.id}')">Edit</button>
                    <button class="btn btn-sm btn-outline" style="color:#f44336;border-color:#f44336;margin-left:5px;" onclick="sellerDeleteProduct('${p.id}')">Delete</button>
                  </div>
                </div>
              </div>
            </div>`;
          }).join('')}
        ${sellerApprovalOrders.length > 0 ? `
        <h3 class="section-title" style="margin-top:25px;">\u2705 Orders Waiting Your Approval (${sellerApprovalOrders.length})</h3>
        ${sellerApprovalOrders.map(o => `
          <div class="card" style="border:1px solid var(--gold);">
            <div style="display:flex;justify-content:space-between;align-items:start;">
              <div><div class="product-name">Order ${esc(o.id)}</div><div style="color:#999;font-size:13px;">${esc(o.customer.name)} \u2022 +91 ${esc(o.customer.mobile)}</div><div style="color:var(--gold);font-weight:bold;margin-top:5px;">${fmtPrice(o.total)} (COD)</div></div>
              <span class="badge badge-pending">Awaiting Your Approval</span>
            </div>
            <div style="margin-top:10px;font-size:13px;color:#aaa;">${o.items.filter(i=>myProductIds.includes(i.id)||myProductIds.includes(i.sellerProductId)).map(i=>`\u2022 ${esc(i.name)} x${i.qty}`).join('<br>')}</div>
            <div style="margin-top:8px;font-size:12px;color:#666;">${esc(o.customer.address)}, ${esc(o.customer.city||'')} ${o.customer.pincode?'- '+esc(o.customer.pincode):''}</div>
            <button class="btn btn-green btn-block" style="margin-top:10px;" onclick="sellerApproveOrder('${o.id}')">\u2705 Approve Order</button>
            <button class="btn btn-outline btn-block" style="margin-top:8px;color:#f44336;border-color:#f44336;" onclick="sellerRejectOrder('${o.id}')">\u274c Reject Order</button>
          </div>
        `).join('')}` : ''}
        <h3 class="section-title" style="margin-top:25px;">\ud83d\udce6 Orders for My Products (${myOrders.length})</h3>
        ${myOrders.length === 0 ? '<div class="empty">No orders yet for your products.</div>' :
          myOrders.map(o=>`<div class="card"><div style="display:flex;justify-content:space-between;align-items:start;"><div><div class="product-name">Order ${esc(o.id)}</div><div style="color:#999;font-size:13px;">${esc(o.customer.name)} \u2022 +91 ${esc(o.customer.mobile)}</div><div style="color:var(--gold);font-weight:bold;margin-top:5px;">${fmtPrice(o.total)}</div></div><span class="badge ${o.status==='Delivered'?'badge-approved':['Cancelled','Customer Cancelled'].includes(o.status)?'badge-rejected':'badge-pending'}">${o.status}</span></div><div style="margin-top:10px;font-size:13px;color:#aaa;">${o.items.filter(i=>myProductIds.includes(i.id)||myProductIds.includes(i.sellerProductId)).map(i=>`\u2022 ${esc(i.name)} x${i.qty}`).join('<br>')}</div></div>`).join('')}
      </div>
    `);
    SELLER_POLL = setInterval(async () => {
      if (CURRENT_ROUTE !== 'seller') return;
      try { renderSellerPanelSilent(); } catch(e) {}
    }, POLL_INTERVAL);
  } catch (e) { apiError(e); }
}

async function renderSellerPanelSilent() {
  // re-fetch and re-render only if changed
  const [sp, ord] = await Promise.all([api('/api/seller-products'), api('/api/seller/orders')]);
  const sig = JSON.stringify((sp.sellerProducts||[]).map(p=>p.id+p.status)) + JSON.stringify((ord.orders||[]).map(o=>o.id+o.status));
  if (sig !== (window._sellerSig||'')) { window._sellerSig = sig; renderSellerPanel(); }
}

// ====== SELLER ADD/EDIT PRODUCT ======
let sellerImages = [];

function renderSellerAddProduct() {
  sellerImages = [];
  render(`
    <div class="app-header"><button class="back-btn" onclick="renderSellerPanel()">\u2190</button><h2>Add Product</h2></div>
    <div class="app-content">
      <div class="card">
        <div class="form-group"><label>Product Name *</label><input type="text" id="spName" placeholder="Product name"></div>
        <div class="form-group"><label>Category *</label><input type="text" id="spCategory" placeholder="e.g. Electronics, Clothing"></div>
        <div class="form-group"><label>Price (\u20b9) *</label><input type="number" id="spPrice" placeholder="Price in rupees" inputmode="numeric"></div>
        <div class="form-group"><label>MRP (\u20b9)</label><input type="number" id="spMrp" placeholder="Original price (for discount)" inputmode="numeric"></div>
        <div class="form-group"><label>Delivery Charge (\u20b9)</label><input type="number" id="spDelivery" placeholder="0 for free delivery" value="0" inputmode="numeric"></div>
        <div class="form-group"><label>Stock Quantity *</label><input type="number" id="spStock" placeholder="Available stock" inputmode="numeric"></div>
        <div class="form-group"><label>Delivery Days *</label><input type="number" id="spDeliveryDays" placeholder="e.g. 5" value="3" min="1" max="30" inputmode="numeric"><p class="small" style="color:#666;">Customer sees expected delivery date based on this</p></div>
        <div class="form-group"><label>Description</label><textarea id="spDesc" rows="3" placeholder="Product description"></textarea></div>
        <div class="form-group"><label>Product Images (Max 5) *</label>
          <div class="file-upload" onclick="document.getElementById('spImageInput').click()"><div class="upload-icon">\ud83d\udcf7</div><p>Click to upload images (max 5)</p><input type="file" id="spImageInput" accept="image/*" multiple style="display:none;" onchange="handleImages(this,'spImagePreview','spImgCount',sellerImages)"></div>
          <div id="spImagePreview" class="upload-preview"></div>
          <p class="small" style="color:#666;">Uploaded: <span id="spImgCount">0</span>/5</p>
        </div>
        <button class="btn btn-gold btn-block" onclick="submitSellerProduct()">Submit for Approval</button>
      </div>
    </div>
  `);
}

function handleImages(input, previewId, countId, arr) {
  const files = Array.from(input.files);
  let toProcess = files.slice(0, 5 - arr.length);
  if (arr.length + files.length > 5) alert('Maximum 5 images. Only adding ' + toProcess.length + ' more.');
  if (toProcess.length === 0) { input.value=''; return; }
  let processed = 0;
  toProcess.forEach(file => {
    if (file.size > 5*1024*1024) { alert(file.name + ' too large (max 5MB)'); processed++; return; }
    compressImage(file, 800, 0.65, function(dataUrl) {
      if (dataUrl) arr.push(dataUrl);
      processed++;
      if (processed === toProcess.length) { updateImagePreview(previewId, countId, arr); input.value=''; }
    });
  });
}
function updateImagePreview(previewId, countId, arr) {
  $(countId).textContent = arr.length;
  $(previewId).innerHTML = arr.map((img,i)=>`<div class="preview-item" style="display:inline-block;width:80px;margin:5px;vertical-align:top;"><img src="${img}" style="width:100%;border-radius:8px;"><button class="btn btn-sm" onclick="removeImg(${i},'${previewId}','${countId}',window.__curArr)" style="padding:2px 8px;">\u2715</button></div>`).join('');
}
function removeImg(index, previewId, countId, arr) { arr.splice(index,1); updateImagePreview(previewId, countId, arr); }

async function submitSellerProduct() {
  const name = $('spName').value.trim();
  const category = $('spCategory').value.trim();
  const price = parseFloat($('spPrice').value);
  const mrp = parseFloat($('spMrp').value) || 0;
  const delivery = parseFloat($('spDelivery').value) || 0;
  const stock = parseInt($('spStock').value);
  const deliveryDays = parseInt($('spDeliveryDays').value) || 3;
  const desc = $('spDesc').value.trim();
  if (!name || !category || !price || !stock) { alert('Please fill all required fields'); return; }
  if (sellerImages.length === 0) { alert('Please add at least 1 product image'); return; }
  showLoader('Submitting product...');
  try {
    await api('/api/seller-products','POST', { name, category, price, mrp, deliveryCharge:delivery, stock, deliveryDays, description:desc, images:sellerImages });
    sellerImages = [];
    render(`<div class="success-screen"><div class="success-icon">\u2705</div><h2 class="gold">Product Submitted!</h2><p style="color:#999;">Your product "${esc(name)}" has been submitted for admin approval. Once approved, it will be visible to customers.</p><button class="btn btn-gold btn-block" onclick="renderSellerPanel()">Back to Panel</button></div>`);
  } catch (e) { apiError(e); }
}

async function renderSellerEditProduct(pid) {
  try {
    const r = await api('/api/seller-products');
    const p = (r.sellerProducts||[]).find(x=>x.id===pid);
    if (!p) return;
    sellerImages = [...(p.images||[])]; window.__curArr = sellerImages;
    render(`
      <div class="app-header"><button class="back-btn" onclick="renderSellerPanel()">\u2190</button><h2>Edit Product</h2></div>
      <div class="app-content">
        <div class="card">
          <div class="form-group"><label>Product Name</label><input type="text" id="spName" value="${esc(p.name)}"></div>
          <div class="form-group"><label>Category</label><input type="text" id="spCategory" value="${esc(p.category)}"></div>
          <div class="form-group"><label>Price (\u20b9)</label><input type="number" id="spPrice" value="${p.price}"></div>
          <div class="form-group"><label>MRP (\u20b9)</label><input type="number" id="spMrp" value="${p.mrp||p.price}"></div>
          <div class="form-group"><label>Delivery Charge (\u20b9)</label><input type="number" id="spDelivery" value="${p.deliveryCharge||0}"></div>
          <div class="form-group"><label>Stock</label><input type="number" id="spStock" value="${p.stock}"></div>
          <div class="form-group"><label>Delivery Days</label><input type="number" id="spDeliveryDays" value="${p.deliveryDays||3}" min="1" max="30"></div>
          <div class="form-group"><label>Product Images</label>
            <div class="file-upload" onclick="document.getElementById('spImageInput').click()"><div class="upload-icon">\ud83d\udcf7</div><p>Add more images (max 5 total)</p><input type="file" id="spImageInput" accept="image/*" multiple style="display:none;" onchange="handleImages(this,'spImagePreview','spImgCount',sellerImages)"></div>
            <div id="spImagePreview" class="upload-preview"></div>
            <p class="small" style="color:#666;">Current: <span id="spImgCount">${sellerImages.length}</span>/5</p>
          </div>
          <div class="form-group"><label>Description</label><textarea id="spDesc" rows="3">${esc(p.description||'')}</textarea></div>
          <button class="btn btn-gold btn-block" onclick="sellerSaveEdit('${pid}')">Save Changes</button>
        </div>
      </div>
    `);
    updateImagePreview('spImagePreview','spImgCount',sellerImages);
  } catch(e) { apiError(e); }
}

async function sellerSaveEdit(pid) {
  showLoader('Saving...');
  try {
    await api('/api/seller-products/'+pid,'PUT', {
      name:$('spName').value.trim(), category:$('spCategory').value.trim(), price:parseFloat($('spPrice').value),
      mrp:parseFloat($('spMrp').value)||0, deliveryCharge:parseFloat($('spDelivery').value)||0,
      stock:parseInt($('spStock').value), deliveryDays:parseInt($('spDeliveryDays').value)||3,
      description:$('spDesc').value.trim(), images:sellerImages
    });
    renderSellerPanel();
  } catch(e) { apiError(e); }
}

async function sellerDeleteProduct(pid) {
  if (!confirm('Delete this product?')) return;
  showLoader('Deleting...');
  try { await api('/api/seller-products/'+pid,'DELETE'); renderSellerPanel(); } catch(e) { apiError(e); }
}

async function sellerApproveOrder(oid) {
  showLoader('Approving order...');
  try { await api('/api/seller/orders/'+oid,'PUT', { status:'Awaiting Delivery' }); renderSellerPanel(); } catch(e) { apiError(e); }
}
async function sellerRejectOrder(oid) {
  if (!confirm('Reject this order? It will be cancelled.')) return;
  showLoader('Rejecting...');
  try { await api('/api/seller/orders/'+oid,'PUT', { status:'Cancelled' }); renderSellerPanel(); } catch(e) { apiError(e); }
}

// ====== DELIVERY PANEL ======
async function renderDeliveryPanel() {
  if (!SESSION || SESSION.user.role !== 'delivery') { renderSDLogin(); return; }
  CURRENT_ROUTE = 'delivery';
  stopAllPolls();
  showLoader('Loading delivery panel...');
  try {
    const r = await api('/api/delivery/orders');
    const myOrders = (r.myOrders||[]).filter(o=>!['Delivered','Cancelled','Customer Cancelled'].includes(o.status));
    const availableOrders = r.available || [];
    const delivered = (r.myOrders||[]).filter(o=>o.status==='Delivered').length;
    render(`
      <div class="app-header"><div class="header-logo gold">Delivery Panel</div><button class="back-btn" onclick="logout()" style="position:relative;">Logout</button></div>
      <div class="app-content" style="padding-bottom:20px;">
        <div class="welcome"><p>Welcome, ${esc(SESSION.user.name||'Delivery Boy')}! \ud83d\ude9a</p></div>
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-num gold">${myOrders.length}</div><div class="stat-label">Active</div></div>
          <div class="stat-card"><div class="stat-num gold">${availableOrders.length}</div><div class="stat-label">Available</div></div>
          <div class="stat-card"><div class="stat-num gold">${delivered}</div><div class="stat-label">Delivered</div></div>
        </div>
        <h3 class="section-title">\ud83d\udce6 Available for Pickup</h3>
        ${availableOrders.length === 0 ? '<div class="empty">No orders available for pickup</div>' :
          availableOrders.map(o=>`<div class="card"><div class="order-id">${o.id}</div><div class="small" style="color:#999;">${new Date(o.createdAt).toLocaleString('en-IN')}</div><div style="margin:10px 0;"><strong>Customer:</strong> ${esc(o.customer.name)}<br><strong>Address:</strong> ${esc(o.customer.address)}, ${esc(o.customer.city||'')} ${o.customer.pincode?'- '+esc(o.customer.pincode):''}<br><strong>Mobile:</strong> <a href="tel:+91${o.customer.mobile}" class="gold">+91 ${o.customer.mobile}</a><br><strong>Items:</strong> ${o.items.length} | <strong>Total:</strong> ${fmtPrice(o.total)} (COD)</div><button class="btn btn-gold btn-block" onclick="acceptDeliveryOrder('${o.id}')">Accept Order</button></div>`).join('')}
        <h3 class="section-title">\ud83d\ude9a My Active Deliveries</h3>
        ${myOrders.length === 0 ? '<div class="empty">No active deliveries</div>' :
          myOrders.map(o=>`<div class="card"><div class="order-id">${o.id}</div><span class="badge badge-status ${o.status==='Out for Delivery'?'badge-outfordelivery':o.status==='Shipped'?'badge-confirmed':'badge-awaitingdelivery'}">${o.status}</span><div style="margin:10px 0;"><strong>Customer:</strong> ${esc(o.customer.name)}<br><strong>Address:</strong> ${esc(o.customer.address)}, ${esc(o.customer.city||'')} ${o.customer.pincode?'- '+esc(o.customer.pincode):''}<br><strong>Mobile:</strong> <a href="tel:+91${o.customer.mobile}" class="gold">+91 ${o.customer.mobile}</a><br><strong>Items:</strong> ${o.items.length} | <strong>Total:</strong> ${fmtPrice(o.total)} (COD)</div>${o.status==='Shipped'?`<button class="btn btn-orange btn-block" onclick="updateDeliveryStatus('${o.id}','Out for Delivery')">Mark Out for Delivery</button>`:''}${o.status==='Out for Delivery'?`<button class="btn btn-green btn-block" onclick="updateDeliveryStatus('${o.id}','Delivered')">Mark as Delivered</button>`:''}</div>`).join('')}
      </div>
    `);
    DELIVERY_POLL = setInterval(async () => {
      if (CURRENT_ROUTE !== 'delivery') return;
      try {
        const rr = await api('/api/delivery/orders');
        const sig = JSON.stringify((rr.myOrders||[]).map(o=>o.id+o.status)) + JSON.stringify((rr.available||[]).map(o=>o.id));
        if (sig !== (window._delSig||'')) { window._delSig = sig; renderDeliveryPanel(); }
      } catch(e) {}
    }, POLL_INTERVAL);
  } catch (e) { apiError(e); }
}

async function acceptDeliveryOrder(oid) {
  showLoader('Accepting order...');
  try { await api('/api/delivery/orders/'+oid,'PUT', { action:'accept' }); renderDeliveryPanel(); } catch(e) { apiError(e); }
}
async function updateDeliveryStatus(oid, status) {
  showLoader('Updating status...');
  try { await api('/api/delivery/orders/'+oid,'PUT', { status }); renderDeliveryPanel(); } catch(e) { apiError(e); }
}

// ====== ADMIN LOGIN ======
function renderAdminLogin() {
  CURRENT_ROUTE = 'adminLogin';
  render(`
    <div class="app-header"><button class="back-btn" onclick="renderLanding()">\u2190</button><h2>Admin Login</h2></div>
    <div class="app-content">
      <div class="card card-gold">
        <h3 class="gold">\u2699\ufe0f Admin Panel Login</h3>
        <div class="form-group"><label>Mobile Number</label><input type="tel" id="adminMobile" placeholder="Admin mobile" maxlength="10" inputmode="numeric"></div>
        <div class="form-group"><label>Password</label><input type="password" id="adminPassword" placeholder="Admin password"></div>
        <button class="btn btn-gold btn-block" onclick="adminLogin()">Login to Admin Panel</button>
      </div>
    </div>
  `);
}

async function adminLogin() {
  const mobile = $('adminMobile').value.trim();
  const password = $('adminPassword').value;
  showLoader('Verifying...');
  try {
    const r = await api('/api/admin-login','POST', { mobile, password });
    SESSION = { token: r.token, user: r.user };
    saveSession();
    renderAdminDashboard();
  } catch (e) { apiError(e); renderAdminLogin(); }
}

// ====== ADMIN DASHBOARD ======
let ADMIN_DATA = null;

async function renderAdminDashboard() {
  if (!SESSION || SESSION.user.role !== 'admin') { renderAdminLogin(); return; }
  CURRENT_ROUTE = 'admin';
  stopAllPolls();
  showLoader('Loading admin dashboard...');
  try {
    ADMIN_DATA = await api('/api/admin/data');
    adminTab = 'dashboard';
    loadAdminTab('dashboard');
    ADMIN_POLL = setInterval(async () => {
      if (CURRENT_ROUTE !== 'admin') return;
      try {
        const fresh = await api('/api/admin/data');
        const sig = JSON.stringify({
          o:(fresh.orders||[]).map(o=>o.id+o.status).join(','),
          r:(fresh.registrations||[]).map(r=>r.id+r.status).join(','),
          s:(fresh.sellerProducts||[]).map(p=>p.id+p.status).join(','),
          u:(fresh.users&&fresh.users.customers||[]).length,
          p:(fresh.products||[]).length
        });
        if (sig !== (window._adminSig||'')) { window._adminSig = sig; ADMIN_DATA = fresh; loadAdminTab(adminTab, true); }
      } catch(e) {}
    }, POLL_INTERVAL);
  } catch (e) { apiError(e); }
}

function renderAdminNav() {
  const tabs = [
    { key:'dashboard', label:'Dashboard', icon:'\ud83d\udcca' },
    { key:'registrations', label:'Registrations', icon:'\ud83d\udcdd' },
    { key:'products', label:'Products', icon:'\ud83d\udce6' },
    { key:'seller', label:'Seller Products', icon:'\ud83c\udfea' },
    { key:'orders', label:'Orders', icon:'\ud83d\uded2' },
    { key:'users', label:'Users', icon:'\ud83d\udc65' },
    { key:'settings', label:'Settings', icon:'\u2699\ufe0f' }
  ];
  return `<div class="admin-nav">${tabs.map(t=>`<button class="admin-tab ${adminTab===t.key?'active':''}" onclick="loadAdminTab('${t.key}')">${t.icon} ${t.label}</button>`).join('')}<button class="admin-tab" onclick="refreshAdminData()" style="color:var(--gold);">\ud83d\udd04 Refresh</button></div>`;
}

async function refreshAdminData() {
  showLoader('Refreshing...');
  try { ADMIN_DATA = await api('/api/admin/data'); loadAdminTab(adminTab); } catch(e) { apiError(e); }
}

function loadAdminTab(tab, isPoll) {
  adminTab = tab;
  const D = ADMIN_DATA || {};
  const settings = D.settings || {};
  const orders = D.orders || [];
  const users = (D.users && D.users.customers) ? D.users.customers : [];
  const regs = D.registrations || [];
  const products = D.products || [];
  const sellerProducts = D.sellerProducts || [];
  const deliveryBoys = D.deliveryBoys || [];

  const pendingRegs = regs.filter(r=>r.status==='pending').length;
  const pendingSeller = sellerProducts.filter(p=>p.status==='pending').length;
  const awaitingAdmin = orders.filter(o=>o.status==='Awaiting Admin').length;
  const sellerApproval = orders.filter(o=>o.status==='Seller Approval').length;
  const awaitingDelivery = orders.filter(o=>o.status==='Awaiting Delivery').length;
  const outForDelivery = orders.filter(o=>o.status==='Out for Delivery').length;
  const delivered = orders.filter(o=>o.status==='Delivered').length;
  const cancelledOrders = orders.filter(o=>['Cancelled','Customer Cancelled'].includes(o.status)).length;

  let content = '';

  if (tab === 'dashboard') {
    content = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-num gold">${orders.length}</div><div class="stat-label">Total Orders</div>${awaitingAdmin>0?`<span class="badge-live">\ud83d\udd34 ${awaitingAdmin} new</span>`:''}</div>
        <div class="stat-card"><div class="stat-num gold">${products.length}</div><div class="stat-label">Products</div></div>
        <div class="stat-card"><div class="stat-num gold">${users.length}</div><div class="stat-label">Customers</div></div>
        <div class="stat-card"><div class="stat-num gold">${regs.length}</div><div class="stat-label">Registrations</div>${pendingRegs>0?`<span class="badge-live">\ud83d\udd34 ${pendingRegs} pending</span>`:''}</div>
        <div class="stat-card"><div class="stat-num gold">${sellerProducts.length}</div><div class="stat-label">Seller Products</div>${pendingSeller>0?`<span class="badge-live">\ud83d\udd34 ${pendingSeller} pending</span>`:''}</div>
        <div class="stat-card"><div class="stat-num gold">${delivered}</div><div class="stat-label">Delivered</div></div>
        <div class="stat-card"><div class="stat-num gold">${cancelledOrders}</div><div class="stat-label">Cancelled</div></div>
      </div>
      <h3 class="section-title">\ud83d\udd34 Live Orders (Awaiting Action)</h3>
      ${awaitingAdmin === 0 ? '<div class="empty">No orders awaiting action</div>' :
        orders.filter(o=>o.status==='Awaiting Admin').reverse().map(o=>`<div class="card" style="border:1px solid var(--gold);"><div class="order-id gold">${o.id}</div><span class="badge badge-awaitingadmin">${o.status}</span><div style="margin:10px 0;"><strong>Customer:</strong> ${esc(o.customer.name)} (+91 ${o.customer.mobile})<br><strong>Items:</strong> ${o.items.length} | <strong>Total:</strong> ${fmtPrice(o.total)} (COD)<br><strong>Address:</strong> ${esc(o.customer.address)}, ${esc(o.customer.city||'')} ${o.customer.pincode?'- '+esc(o.customer.pincode):''}</div><button class="btn btn-green btn-block" onclick="adminAcceptOrder('${o.id}')">\u2705 Accept & Send to Seller</button><button class="btn btn-outline btn-block" style="margin-top:8px;color:#f44336;border-color:#f44336;" onclick="adminRejectOrder('${o.id}')">\u274c Reject Order</button></div>`).join('')}
      ${sellerApproval > 0 ? `<h3 class="section-title" style="margin-top:25px;">\ud83d\udce6 Awaiting Seller Approval (${sellerApproval})</h3>${orders.filter(o=>o.status==='Seller Approval').reverse().map(o=>`<div class="card"><div class="order-id gold">${o.id}</div><span class="badge badge-pending">${o.status}</span><div style="margin:10px 0;"><strong>Customer:</strong> ${esc(o.customer.name)} (+91 ${o.customer.mobile})<br><strong>Items:</strong> ${o.items.map(i=>esc(i.name)+' x'+i.qty).join(', ')}<br><strong>Total:</strong> ${fmtPrice(o.total)} (COD)</div><div class="small" style="color:#999;">Waiting for seller to approve this order...</div></div>`).join('')}` : ''}
      ${awaitingDelivery > 0 ? `<h3 class="section-title" style="margin-top:25px;">\ud83d\ude9a Ready for Delivery (${awaitingDelivery})</h3>${orders.filter(o=>o.status==='Awaiting Delivery').reverse().map(o=>`<div class="card" style="border:1px solid #4CAF50;"><div class="order-id gold">${o.id}</div><span class="badge badge-awaitingdelivery">${o.status}</span><div style="margin:10px 0;"><strong>Customer:</strong> ${esc(o.customer.name)} (+91 ${o.customer.mobile})<br><strong>Address:</strong> ${esc(o.customer.address)}, ${esc(o.customer.city||'')} ${o.customer.pincode?'- '+esc(o.customer.pincode):''}<br><strong>Items:</strong> ${o.items.length} | <strong>Total:</strong> ${fmtPrice(o.total)} (COD)${o.assignedDelivery?`<br><strong>Delivery Boy:</strong> ${esc(o.deliveryName||o.assignedDelivery)}`:''}</div>${!o.assignedDelivery?`<button class="btn btn-gold btn-block" onclick="adminAssignDelivery('${o.id}')">Assign Delivery Boy</button>`:'<div class="alert alert-success" style="margin-top:8px;">Delivery boy assigned - waiting for acceptance</div>'}</div>`).join('')}` : ''}
      <h3 class="section-title">\ud83d\ude9a Shipped / Out for Delivery</h3>
      ${(outForDelivery + orders.filter(o=>o.status==='Shipped').length) === 0 ? '<div class="empty">No orders in transit</div>' :
        orders.filter(o=>['Out for Delivery','Shipped'].includes(o.status)).map(o=>`<div class="card"><div class="order-id">${o.id}</div><span class="badge badge-outfordelivery">${o.status}</span><div style="margin:10px 0;"><strong>Customer:</strong> ${esc(o.customer.name)}<br><strong>Delivery Boy:</strong> ${esc(o.deliveryName||o.assignedDelivery||'Not assigned')}</div></div>`).join('')}
    `;
  }
  else if (tab === 'registrations') {
    content = `<h3 class="section-title">\ud83d\udcdd Registrations (${regs.length})</h3>
      ${regs.length === 0 ? '<div class="empty">No registrations yet</div>' :
        regs.reverse().map(r=>`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;"><div><strong class="gold">${esc(r.name)}</strong><span class="badge ${r.status==='approved'?'badge-approved':r.status==='rejected'?'badge-rejected':r.status==='blocked'?'badge-cancelled':'badge-pending'}">${r.status}</span></div><div class="small" style="color:#999;">${r.role}</div></div><div style="margin:10px 0;"><strong>Mobile:</strong> +91 ${r.mobile}<br><strong>City:</strong> ${esc(r.city)}<br>${r.shop?`<strong>Shop:</strong> ${esc(r.shop)}<br>`:''}<strong>Aadhar:</strong> ${r.aadhar||'-'}<br><strong>Registered:</strong> ${new Date(r.createdAt).toLocaleString('en-IN')}${r.password?`<br><strong>Password:</strong> ${esc(r.password)} (set)`:'<br><strong>Password:</strong> Not set yet'}</div><div class="doc-preview-row"><div class="doc-preview" onclick="viewImageSrc('${esc(r.aadharPhoto)}')">${r.aadharPhoto?`<img src="${r.aadharPhoto}" style="width:100%;height:100%;object-fit:cover;">`:'<div class="doc-label">No</div>'}<div class="doc-label">Aadhar</div></div><div class="doc-preview" onclick="viewImageSrc('${esc(r.photo)}')">${r.photo?`<img src="${r.photo}" style="width:100%;height:100%;object-fit:cover;">`:'<div class="doc-label">No</div>'}<div class="doc-label">Photo</div></div></div>${r.status==='pending'?`<button class="btn btn-green btn-block" onclick="adminApproveReg('${r.id}')">\u2705 Approve & Set Password</button><button class="btn btn-outline btn-block" style="margin-top:8px;color:#f44336;border-color:#f44336;" onclick="adminRejectReg('${r.id}')">\u274c Reject</button>`:r.status==='approved'?`<button class="btn btn-outline btn-block" onclick="adminResetPassword('${r.id}')" style="margin-bottom:8px;">\ud83d\udd11 Reset Password</button><button class="btn btn-outline btn-block" style="color:#f44336;border-color:#f44336;" onclick="adminBlockReg('${r.id}')">\ud83d\udeab Block</button>`:r.status==='blocked'?`<button class="btn btn-green btn-block" onclick="adminUnblockReg('${r.id}')">\u2705 Unblock</button>`:''}</div>`).join('')}`;
  }
  else if (tab === 'products') {
    content = `<h3 class="section-title">\ud83d\udce6 Admin Products (${products.length})</h3>
      <button class="btn btn-gold btn-block" onclick="renderAdminAddProduct()">\u2795 Add Product</button>
      ${products.map(p=>{ const img=(p.images&&p.images[0])?p.images[0]:(p.image||''); return `<div class="card"><div style="display:flex;gap:10px;"><div class="product-img" style="width:80px;height:80px;flex-shrink:0;background-image:url('${esc(img)}')"></div><div style="flex:1;"><div class="product-name">${esc(p.name)}</div><div class="product-price">${fmtPrice(p.price)}</div><div class="small" style="color:#999;">Stock: ${p.stock} | ${esc(p.category)}${p.deliveryDays?' | \ud83d\ude9a '+p.deliveryDays+'d':''}</div><div style="margin-top:8px;"><button class="btn btn-sm btn-outline" onclick="renderAdminEditProduct('${p.id}')">Edit</button><button class="btn btn-sm btn-outline" style="color:#f44336;border-color:#f44336;margin-left:5px;" onclick="adminDeleteProduct('${p.id}')">Delete</button></div></div></div></div>`; }).join('')}`;
  }
  else if (tab === 'seller') {
    content = `<h3 class="section-title">\ud83c\udfea Seller Products (${sellerProducts.length})</h3>
      ${sellerProducts.length === 0 ? '<div class="empty">No seller products submitted yet</div>' :
        sellerProducts.reverse().map(p=>{ const img=(p.images&&p.images[0])?p.images[0]:(p.image||''); return `<div class="card"><div style="display:flex;gap:10px;"><div class="product-img" style="width:80px;height:80px;flex-shrink:0;background-image:url('${esc(img)}')"></div><div style="flex:1;"><div class="product-name">${esc(p.name)}</div><div class="product-price">${fmtPrice(p.price)}</div><div class="small" style="color:#999;">By: ${esc(p.sellerName)} (+91 ${p.sellerMobile})</div><div class="small" style="color:#999;">Stock: ${p.stock}${p.deliveryDays?' | \ud83d\ude9a '+p.deliveryDays+'d':''}</div><span class="badge ${p.status==='approved'?'badge-approved':p.status==='rejected'?'badge-rejected':'badge-pending'}">${p.status}</span></div></div>${p.images&&p.images.length>1?`<div class="gallery-thumbs" style="margin:10px 0;">${p.images.map(img=>`<div class="gallery-thumb" style="width:40px;height:40px;background-image:url('${esc(img)}')"></div>`).join('')}</div>`:''}<p class="small" style="color:#999;margin:8px 0;">${esc(p.description||'')}</p>${p.status==='pending'?`<button class="btn btn-green btn-block" onclick="adminApproveSellerProduct('${p.id}')">\u2705 Approve (Make Live)</button><button class="btn btn-outline btn-block" style="margin-top:8px;color:#f44336;border-color:#f44336;" onclick="adminRejectSellerProduct('${p.id}')">\u274c Reject</button>`:p.status==='approved'?'<div class="alert alert-success" style="margin-top:8px;">\u2705 Approved & visible to customers</div>':'<div class="alert alert-error" style="margin-top:8px;">\u274c Rejected</div>'}</div>`; }).join('')}`;
  }
  else if (tab === 'orders') {
    const statusCounts = {}; orders.forEach(o=>{ statusCounts[o.status] = (statusCounts[o.status]||0)+1; });
    content = `<h3 class="section-title">\ud83d\uded2 All Orders (${orders.length})</h3>
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(100px,1fr));">${Object.entries(statusCounts).map(([s,c])=>`<div class="stat-card"><div class="stat-num gold">${c}</div><div class="stat-label">${s}</div></div>`).join('')}</div>
      ${orders.length === 0 ? '<div class="empty">No orders yet</div>' :
        orders.reverse().map(o=>`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;"><div class="order-id gold">${o.id}</div><span class="badge badge-status ${o.status==='Delivered'?'badge-delivered':['Cancelled','Customer Cancelled'].includes(o.status)?'badge-cancelled':o.status==='Out for Delivery'?'badge-outfordelivery':o.status==='Shipped'?'badge-confirmed':o.status==='Awaiting Delivery'?'badge-awaitingdelivery':'badge-awaitingadmin'}">${o.status}</span></div><div class="small" style="color:#999;">${new Date(o.createdAt).toLocaleString('en-IN')}</div>${o.cancelledBy?`<div class="small" style="color:#f44336;">Cancelled by: ${esc(o.cancelledBy)}</div>`:''}<div style="margin:10px 0;"><strong>Customer:</strong> ${esc(o.customer.name)} (+91 ${o.customer.mobile})<br><strong>Address:</strong> ${esc(o.customer.address)}, ${esc(o.customer.city||'')} ${o.customer.pincode?'- '+esc(o.customer.pincode):''}<br><strong>Items:</strong> ${o.items.map(i=>esc(i.name)+' \u00d7'+i.qty).join(', ')}<br><strong>Total:</strong> ${fmtPrice(o.total)} (COD)${o.expectedDelivery?`<br><strong>Expected Delivery:</strong> ${getDeliveryDate(o)}`:''}${o.assignedDelivery?`<br><strong>Delivery Boy:</strong> ${esc(o.deliveryName||o.assignedDelivery)}`:''}</div><div class="tracking" style="margin:10px 0;">${(o.statusHistory||[]).map(h=>`<div class="small" style="color:#666;">\u2192 ${h.status} (${new Date(h.time).toLocaleString('en-IN')})</div>`).join('')}</div><div style="display:flex;gap:5px;flex-wrap:wrap;">${o.status==='Awaiting Admin'?`<button class="btn btn-sm btn-green" onclick="adminAcceptOrder('${o.id}')">\u2705 Accept & Send to Seller</button><button class="btn btn-sm btn-outline" style="color:#f44336;border-color:#f44336;" onclick="adminRejectOrder('${o.id}')">\u274c Reject</button>`:''}${o.status==='Awaiting Delivery'&&!o.assignedDelivery?`<button class="btn btn-sm btn-gold" onclick="adminAssignDelivery('${o.id}')">Assign Delivery Boy</button>`:''}${['Shipped','Out for Delivery'].includes(o.status)?`<button class="btn btn-sm btn-green" onclick="adminOrderStatus('${o.id}','Delivered')">\u2705 Mark Delivered</button>`:''}</div></div>`).join('')}`;
  }
  else if (tab === 'users') {
    content = `<h3 class="section-title">\ud83d\udc65 Customers (${users.length})</h3>
      ${users.length === 0 ? '<div class="empty">No customers registered yet</div>' :
        users.reverse().map(u=>`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;"><div><strong class="gold">${esc(u.name||'Unnamed')}</strong><span class="badge ${u.status==='blocked'?'badge-cancelled':'badge-approved'}">${u.status||'active'}</span></div></div><div style="margin:10px 0;"><strong>Mobile:</strong> +91 ${u.mobile}<br>${u.address?`<strong>Address:</strong> ${esc(u.address)}, ${esc(u.city||'')} - ${esc(u.pincode||'')}<br>`:''}<strong>Joined:</strong> ${new Date(u.createdAt).toLocaleString('en-IN')}</div><div style="margin-bottom:8px;"><strong>Orders:</strong> ${orders.filter(o=>o.customerMobile===u.mobile).length}</div>${u.status==='blocked'?`<button class="btn btn-sm btn-green" onclick="adminUnblockUser('${u.id}')">\u2705 Unblock</button>`:`<button class="btn btn-sm btn-outline" style="color:#f44336;border-color:#f44336;" onclick="adminBlockUser('${u.id}')">\ud83d\udeab Block</button>`}</div>`).join('')}`;
  }
  else if (tab === 'settings') {
    content = `<h3 class="section-title">\u2699\ufe0f Store Settings</h3>
      <div class="card">
        <div class="form-group"><label>Store Name</label><input type="text" id="setStoreName" value="${esc(settings.storeName||'')}"></div>
        <div class="form-group"><label>Store Tagline</label><input type="text" id="setStoreTagline" value="${esc(settings.storeTagline||'')}"></div>
        <div class="form-group"><label>Admin Mobile</label><input type="tel" id="setAdminMobile" value="${esc(settings.adminMobile||'')}" maxlength="10"></div>
        <div class="form-group"><label>Admin Password</label><input type="text" id="setAdminPassword" value="${esc(settings.adminPassword||'')}"></div>
        <button class="btn btn-gold btn-block" onclick="adminSaveSettings()">Save Settings</button>
      </div>
      <div class="card" style="margin-top:15px;"><h4 class="gold">\ud83d\udcca System Info</h4><p class="small">Products: ${products.length}<br>Seller Products: ${sellerProducts.length}<br>Orders: ${orders.length}<br>Customers: ${users.length}<br>Registrations: ${regs.length}</p><p class="small" style="color:#666;">Backend: Live REST API - real-time across India</p></div>`;
  }

  if (!isPoll) {
    render(`<div class="app-header"><div class="header-logo gold">Admin Panel</div><button class="back-btn" onclick="logout()" style="position:relative;">Logout</button></div>${renderAdminNav()}<div class="app-content" style="padding-bottom:20px;"><div id="adminContent">${content}</div></div>`);
  } else {
    const ac = $('adminContent'); if (ac) ac.innerHTML = content;
  }
}

// ====== ADMIN ACTIONS ======
async function adminReloadAndRender() {
  ADMIN_DATA = await api('/api/admin/data');
  loadAdminTab(adminTab);
}

async function adminAcceptOrder(oid) {
  showLoader('Accepting & sending to seller...');
  try { await api('/api/admin/orders/'+oid+'/status','PUT', { status:'Seller Approval' }); await adminReloadAndRender(); } catch(e) { apiError(e); }
}
async function adminRejectOrder(oid) {
  if (!confirm('Reject this order?')) return;
  showLoader('Rejecting...');
  try { await api('/api/admin/orders/'+oid+'/status','PUT', { status:'Cancelled', note:'Rejected by Admin' }); await adminReloadAndRender(); } catch(e) { apiError(e); }
}
async function adminOrderStatus(oid, status) {
  showLoader('Updating...');
  try { await api('/api/admin/orders/'+oid+'/status','PUT', { status }); await adminReloadAndRender(); } catch(e) { apiError(e); }
}

async function adminAssignDelivery(oid) {
  const D = ADMIN_DATA || await api('/api/admin/data');
  const deliveryBoys = (D.registrations||[]).filter(r=>r.role==='delivery'&&r.status==='approved');
  if (deliveryBoys.length === 0) { alert('No approved delivery boys. Approve a delivery boy registration first.'); return; }
  const choice = prompt('Choose delivery boy (enter number):\n\n' + deliveryBoys.map((d,i)=>`${i+1}. ${d.name} (+91 ${d.mobile})`).join('\n'));
  if (!choice) return;
  const idx = parseInt(choice)-1;
  if (isNaN(idx)||idx<0||idx>=deliveryBoys.length) { alert('Invalid selection'); return; }
  const boy = deliveryBoys[idx];
  showLoader('Assigning delivery boy...');
  try { await api('/api/admin/orders/'+oid+'/assign-delivery','POST', { deliveryBoyId:boy.id }); await adminReloadAndRender(); } catch(e) { apiError(e); }
}

async function adminApproveReg(rid) {
  const password = prompt('Set a password for this user (they will login with this):');
  if (!password) return;
  if (password.length < 4) { alert('Password must be at least 4 characters'); return; }
  showLoader('Approving...');
  try { await api('/api/registrations/'+rid+'/approve','POST', { password }); await adminReloadAndRender(); } catch(e) { apiError(e); }
}
async function adminResetPassword(rid) {
  const password = prompt('Set a new password for this user:');
  if (!password) return;
  if (password.length < 4) { alert('Password must be at least 4 characters'); return; }
  showLoader('Resetting...');
  try { await api('/api/registrations/'+rid+'/reset-password','POST', { password }); await adminReloadAndRender(); } catch(e) { apiError(e); }
}
async function adminRejectReg(rid) { if(!confirm('Reject?'))return; showLoader('Rejecting...'); try{ await api('/api/registrations/'+rid+'/reject','POST',{}); await adminReloadAndRender(); }catch(e){apiError(e);} }
async function adminBlockReg(rid) { if(!confirm('Block?'))return; showLoader('Blocking...'); try{ await api('/api/registrations/'+rid+'/block','POST',{}); await adminReloadAndRender(); }catch(e){apiError(e);} }
async function adminUnblockReg(rid) { showLoader('Unblocking...'); try{ await api('/api/registrations/'+rid+'/unblock','POST',{}); await adminReloadAndRender(); }catch(e){apiError(e);} }

async function adminApproveSellerProduct(pid) {
  showLoader('Approving & making live...');
  try { await api('/api/seller-products/'+pid+'/approve','POST', {}); await adminReloadAndRender(); } catch(e) { apiError(e); }
}
async function adminRejectSellerProduct(pid) { if(!confirm('Reject?'))return; showLoader('Rejecting...'); try{ await api('/api/seller-products/'+pid+'/reject','POST',{}); await adminReloadAndRender(); }catch(e){apiError(e);} }
async function adminDeleteProduct(pid) { if(!confirm('Delete this product?'))return; showLoader('Deleting...'); try{ await api('/api/admin/products/'+pid,'DELETE'); await adminReloadAndRender(); }catch(e){apiError(e);} }

async function adminBlockUser(uid_) { if(!confirm('Block?'))return; showLoader('Blocking...'); try{ await api('/api/admin/users/'+uid_,'PUT',{status:'blocked'}); await adminReloadAndRender(); }catch(e){apiError(e);} }
async function adminUnblockUser(uid_) { showLoader('Unblocking...'); try{ await api('/api/admin/users/'+uid_,'PUT',{status:'active'}); await adminReloadAndRender(); }catch(e){apiError(e);} }

async function adminSaveSettings() {
  showLoader('Saving...');
  try { await api('/api/settings','POST', { storeName:$('setStoreName').value.trim(), storeTagline:$('setStoreTagline').value.trim(), adminMobile:$('setAdminMobile').value.trim(), adminPassword:$('setAdminPassword').value }); await adminReloadAndRender(); alert('Settings saved!'); } catch(e) { apiError(e); }
}

// ====== ADMIN ADD/EDIT PRODUCT ======
let adminImages = [];

function renderAdminAddProduct() {
  adminImages = []; window.__curArr = adminImages;
  render(`
    <div class="app-header"><button class="back-btn" onclick="loadAdminTab('products')">\u2190</button><h2>Add Product</h2></div>
    <div class="app-content">
      <div class="card">
        <div class="form-group"><label>Product Name *</label><input type="text" id="apName" placeholder="Product name"></div>
        <div class="form-group"><label>Category *</label><input type="text" id="apCategory" placeholder="Category"></div>
        <div class="form-group"><label>Price (\u20b9) *</label><input type="number" id="apPrice" placeholder="Price" inputmode="numeric"></div>
        <div class="form-group"><label>MRP (\u20b9)</label><input type="number" id="apMrp" placeholder="Original price" inputmode="numeric"></div>
        <div class="form-group"><label>Delivery Charge (\u20b9)</label><input type="number" id="apDelivery" value="0" inputmode="numeric"></div>
        <div class="form-group"><label>Stock *</label><input type="number" id="apStock" placeholder="Stock" inputmode="numeric"></div>
        <div class="form-group"><label>Delivery Days *</label><input type="number" id="apDeliveryDays" value="3" min="1" max="30" inputmode="numeric"><p class="small" style="color:#666;">Customer sees expected delivery date based on this</p></div>
        <div class="form-group"><label>Product Images (Max 5) *</label>
          <div class="file-upload" onclick="document.getElementById('apImageInput').click()"><div class="upload-icon">\ud83d\udcf7</div><p>Click to upload images (max 5)</p><input type="file" id="apImageInput" accept="image/*" multiple style="display:none;" onchange="handleImages(this,'apImagePreview','apImgCount',adminImages)"></div>
          <div id="apImagePreview" class="upload-preview"></div>
          <p class="small" style="color:#666;">Uploaded: <span id="apImgCount">0</span>/5</p>
        </div>
        <div class="form-group"><label>Description</label><textarea id="apDesc" rows="3" placeholder="Description"></textarea></div>
        <button class="btn btn-gold btn-block" onclick="adminAddProduct()">Add Product</button>
      </div>
    </div>
  `);
}

async function adminAddProduct() {
  const name=$('apName').value.trim(), category=$('apCategory').value.trim(), price=parseFloat($('apPrice').value), mrp=parseFloat($('apMrp').value)||0, delivery=parseFloat($('apDelivery').value)||0, stock=parseInt($('apStock').value), deliveryDays=parseInt($('apDeliveryDays').value)||3, desc=$('apDesc').value.trim();
  if (!name||!category||!price||!stock) { alert('Please fill all required fields'); return; }
  if (adminImages.length===0) { alert('Please add at least 1 image'); return; }
  showLoader('Adding product...');
  try { await api('/api/admin/products','POST', { name, category, price, mrp, deliveryCharge:delivery, stock, deliveryDays, description:desc, images:adminImages }); adminImages=[]; await adminReloadAndRender(); } catch(e) { apiError(e); }
}

async function renderAdminEditProduct(pid) {
  const D = ADMIN_DATA || await api('/api/admin/data');
  const p = (D.products||[]).find(x=>x.id===pid);
  if (!p) return;
  adminImages = [...(p.images||[])]; window.__curArr = adminImages;
  render(`
    <div class="app-header"><button class="back-btn" onclick="loadAdminTab('products')">\u2190</button><h2>Edit Product</h2></div>
    <div class="app-content">
      <div class="card">
        <div class="form-group"><label>Product Name</label><input type="text" id="epName" value="${esc(p.name)}"></div>
        <div class="form-group"><label>Category</label><input type="text" id="epCategory" value="${esc(p.category)}"></div>
        <div class="form-group"><label>Price (\u20b9)</label><input type="number" id="epPrice" value="${p.price}"></div>
        <div class="form-group"><label>MRP (\u20b9)</label><input type="number" id="epMrp" value="${p.mrp||p.price}"></div>
        <div class="form-group"><label>Delivery Charge (\u20b9)</label><input type="number" id="epDelivery" value="${p.deliveryCharge||0}"></div>
        <div class="form-group"><label>Stock</label><input type="number" id="epStock" value="${p.stock}"></div>
        <div class="form-group"><label>Delivery Days</label><input type="number" id="epDeliveryDays" value="${p.deliveryDays||3}" min="1" max="30"></div>
        <div class="form-group"><label>Product Images</label>
          <div class="file-upload" onclick="document.getElementById('epImageInput').click()"><div class="upload-icon">\ud83d\udcf7</div><p>Add more images (max 5 total)</p><input type="file" id="epImageInput" accept="image/*" multiple style="display:none;" onchange="handleImages(this,'epImagePreview','epImgCount',adminImages)"></div>
          <div id="epImagePreview" class="upload-preview"></div>
          <p class="small" style="color:#666;">Current: <span id="epImgCount">${adminImages.length}</span>/5</p>
        </div>
        <div class="form-group"><label>Description</label><textarea id="epDesc" rows="3">${esc(p.description||'')}</textarea></div>
        <button class="btn btn-gold btn-block" onclick="adminEditProduct('${pid}')">Save Changes</button>
      </div>
    </div>
  `);
  updateImagePreview('epImagePreview','epImgCount',adminImages);
}

async function adminEditProduct(pid) {
  showLoader('Saving...');
  try {
    await api('/api/admin/products/'+pid,'PUT', {
      name:$('epName').value.trim(), category:$('epCategory').value.trim(), price:parseFloat($('epPrice').value),
      mrp:parseFloat($('epMrp').value)||0, deliveryCharge:parseFloat($('epDelivery').value)||0, stock:parseInt($('epStock').value),
      deliveryDays:parseInt($('epDeliveryDays').value)||3, description:$('epDesc').value.trim(), images:adminImages
    });
    await adminReloadAndRender();
  } catch(e) { apiError(e); }
}

function viewImageSrc(src) {
  if (!src) { alert('No image available'); return; }
  const w = window.open('', '_blank');
  w.document.write(`<html><head><title>Document View</title></head><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh;"><img src="${src}" style="max-width:100%;max-height:100%;"></body></html>`);
  w.document.close();
}

// ====== START ======
window.onload = init;
