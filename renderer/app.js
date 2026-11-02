'use strict';

// نکته: window.api توسط preload به شکل یک پراپرتی غیرقابل‌تنظیم روی window ساخته می‌شود؛
// اعلان «const api = ...» در اسکوپ گلوبال خطای redeclare می‌دهد. پس فقط از window.api استفاده می‌کنیم.
const $ = (sel) => document.querySelector(sel);

let products = [];
let currentImages = [];
let editingId = null;

const money = (n) => `${Number(n || 0).toLocaleString('fa-IR')} تومان`;
const imgUrl = (name) => `appimg://img/${encodeURIComponent(name)}`;

function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------------- تب‌ها ---------------- */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab.dataset.tab}`));
  });
});

/* ---------------- محصولات ---------------- */
async function loadProducts() {
  products = await api.listProducts();
  renderCategories();
  renderGrid();
}

function renderCategories() {
  const cats = [...new Set(products.map((p) => p.category).filter(Boolean))];
  const filter = $('#filterCat');
  const current = filter.value;
  filter.innerHTML = '<option value="">همه دسته‌ها</option>';
  cats.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    filter.appendChild(opt);
  });
  filter.value = cats.includes(current) ? current : '';

  const dl = $('#catList');
  dl.innerHTML = '';
  cats.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c;
    dl.appendChild(opt);
  });
}

function renderGrid() {
  const q = $('#search').value.trim().toLowerCase();
  const cat = $('#filterCat').value;
  const list = products.filter((p) => {
    const matchQ =
      !q ||
      [p.name, p.category, p.description, p.material, p.size].join(' ').toLowerCase().includes(q);
    return matchQ && (!cat || p.category === cat);
  });

  const grid = $('#grid');
  grid.innerHTML = '';
  $('#empty').classList.toggle('hidden', list.length > 0);

  for (const p of list) {
    const card = document.createElement('article');
    card.className = 'product-card' + (p.active === false ? ' inactive' : '');

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (p.images?.[0]) thumb.style.backgroundImage = `url("${imgUrl(p.images[0])}")`;
    else thumb.textContent = '🖼️';

    const body = document.createElement('div');
    body.className = 'p-body';

    const name = document.createElement('div');
    name.className = 'p-name';
    name.textContent = p.name;

    const catEl = document.createElement('div');
    catEl.className = 'p-cat';
    catEl.textContent = [p.category, p.size, p.material].filter(Boolean).join(' • ') || 'بدون دسته';

    const price = document.createElement('div');
    price.className = 'p-price';
    price.textContent = money(p.price);

    const meta = document.createElement('div');
    meta.className = 'p-meta';
    meta.innerHTML = `<span>موجودی: ${Number(p.stock) || 0}</span><span>${p.active === false ? '⛔ غیرفعال' : '✅ فعال'}</span><span>${p.images?.length || 0} عکس</span>`;

    body.append(name, catEl, price, meta);

    const actions = document.createElement('div');
    actions.className = 'p-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn';
    editBtn.textContent = 'ویرایش';
    editBtn.onclick = () => openModal(p);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn';
    toggleBtn.textContent = p.active === false ? 'فعال‌سازی' : 'غیرفعال';
    toggleBtn.onclick = async () => {
      await api.saveProduct({ ...p, active: p.active === false });
      await loadProducts();
      toast('وضعیت محصول تغییر کرد');
    };

    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger-ghost';
    delBtn.textContent = 'حذف';
    delBtn.onclick = async () => {
      if (!confirm(`«${p.name}» حذف شود؟`)) return;
      await api.deleteProduct(p.id);
      await loadProducts();
      toast('محصول حذف شد');
    };

    actions.append(editBtn, toggleBtn, delBtn);
    card.append(thumb, body, actions);
    grid.appendChild(card);
  }
}

$('#search').addEventListener('input', renderGrid);
$('#filterCat').addEventListener('change', renderGrid);

/* ---------------- مودال ---------------- */
function openModal(product = null) {
  editingId = product?.id ?? null;
  currentImages = product ? [...(product.images || [])] : [];
  $('#modalTitle').textContent = product ? 'ویرایش محصول' : 'محصول جدید';
  $('#f-name').value = product?.name || '';
  $('#f-category').value = product?.category || '';
  $('#f-price').value = product?.price ?? '';
  $('#f-stock').value = product?.stock ?? 0;
  $('#f-material').value = product?.material || '';
  $('#f-size').value = product?.size || '';
  $('#f-colors').value = (product?.colors || []).join('، ');
  $('#f-description').value = product?.description || '';
  $('#f-active').checked = product ? product.active !== false : true;
  renderThumbs();
  $('#modal').classList.remove('hidden');
}

function closeModal() {
  $('#modal').classList.add('hidden');
  editingId = null;
  currentImages = [];
}

function renderThumbs() {
  const wrap = $('#thumbs');
  wrap.innerHTML = '';
  currentImages.forEach((name) => {
    const item = document.createElement('div');
    item.className = 'thumb-item';

    const img = document.createElement('img');
    img.src = imgUrl(name);
    img.alt = 'عکس محصول';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '✕';
    btn.title = 'حذف عکس';
    btn.onclick = async () => {
      await api.removeImage(name);
      currentImages = currentImages.filter((n) => n !== name);
      renderThumbs();
    };

    item.append(img, btn);
    wrap.appendChild(item);
  });
}

$('#btnAddImages').onclick = async () => {
  const picked = await api.pickImages();
  if (picked.length) {
    currentImages = [...currentImages, ...picked];
    renderThumbs();
  }
};

$('#btnSaveProduct').onclick = async () => {
  const payload = {
    id: editingId || undefined,
    name: $('#f-name').value.trim(),
    category: $('#f-category').value.trim(),
    price: Number($('#f-price').value) || 0,
    stock: Number($('#f-stock').value) || 0,
    material: $('#f-material').value.trim(),
    size: $('#f-size').value.trim(),
    colors: $('#f-colors').value,
    description: $('#f-description').value.trim(),
    images: currentImages,
    active: $('#f-active').checked,
  };

  if (!payload.name) return toast('نام محصول را وارد کنید', true);

  try {
    await api.saveProduct(payload);
    closeModal();
    await loadProducts();
    toast('محصول ذخیره شد');
  } catch (err) {
    toast(err.message || 'خطا در ذخیره', true);
  }
};

$('#btnNew').onclick = () => openModal();
$('#btnNewEmpty').onclick = () => openModal();
$('#btnCloseModal').onclick = closeModal;
$('#btnCancel').onclick = closeModal;
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

/* ---------------- تنظیمات و ربات ---------------- */
async function loadSettings() {
  const s = await api.getSettings();
  $('#s-shopName').value = s.shopName || '';
  $('#s-note').value = s.note || '';
  $('#s-botToken').value = s.botToken || '';
  $('#s-shopChatId').value = s.shopChatId || '';
}

function applyBotStatus(status) {
  const pill = $('#botPill');
  const text = $('#botStatusText');
  pill.textContent = `ربات: ${status.running ? 'فعال' : 'غیرفعال'}`;
  pill.classList.toggle('on', !!status.running);
  pill.classList.toggle('off', !status.running);
  pill.title = status.message || '';
  text.textContent = `وضعیت: ${status.message || '—'}`;
}

$('#btnSaveSettings').onclick = async () => {
  const { botStatus } = await api.saveSettings({
    shopName: $('#s-shopName').value,
    note: $('#s-note').value,
    botToken: $('#s-botToken').value,
    shopChatId: $('#s-shopChatId').value,
  });
  applyBotStatus(botStatus);
  toast('تنظیمات ذخیره شد');
};

$('#btnBotStart').onclick = async () => {
  const status = await api.botStart();
  applyBotStatus(status);
  toast(status.running ? 'ربات روشن شد' : status.message, !status.running);
};

$('#btnBotStop').onclick = async () => {
  const status = await api.botStop();
  applyBotStatus(status);
  toast('ربات خاموش شد');
};

api.onBotStatus(applyBotStatus);

$('#btnOpenData').onclick = () => api.openDataDir();

/* ---------------- شروع ---------------- */
(async function init() {
  await loadProducts();
  await loadSettings();
  try {
    const info = await api.getAppInfo();
    $('#appVersion').textContent = info.version;
  } catch {}
})();
