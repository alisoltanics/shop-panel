'use strict';

// نکته: window.api توسط preload روی window ساخته می‌شود؛ اعلان «const api = ...»
// در اسکوپ گلوبال خطای redeclare می‌دهد، پس مستقیم از api گلوبال استفاده می‌کنیم.

const $ = (sel) => document.querySelector(sel);

let products = [];
let orders = [];
let categories = [];
let capacityOptions = [];
let shapeOptions = [];
let colorOptions = [];
let currentImages = [];
let currentVideo = '';
let currentSizes = [];
let editingId = null;

const money = (n) => `${Number(n || 0).toLocaleString('fa-IR')} تومان`;

/** ارقام فارسی/عربی را به انگلیسی تبدیل می‌کند تا فیلدهای عددی با کیبورد فارسی هم کار کنند */
function toEnglishDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[،,٬\s]/g, '');
}

function num(value) {
  return Number(toEnglishDigits(value)) || 0;
}
const imgUrl = (name) => `appimg://img/${encodeURIComponent(name)}`;
const videoUrl = (name) => `appimg://video/${encodeURIComponent(name)}`;

function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------------- تب‌ها ---------------- */
const PAGE_META = {
  products: ['محصولات', 'کاتالوگ فروشگاه را مدیریت کنید'],
  orders: ['سفارش‌ها', 'پیگیری سفارش‌های ثبت‌شده از ربات'],
  customers: ['مشتریان', 'خریداران نهایی‌شده و تاریخچه خریدشان'],
  views: ['بازدیدها', 'چه کسانی لیست محصولات ربات را دیده‌اند'],
  abuse: ['گزارش تخلف', 'کاربران مزاحم و مسدودسازی آن‌ها'],
  settings: ['تنظیمات و ربات‌ها', 'اتصال تلگرام و بله، دسته‌بندی و گزینه‌ها'],
};

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab.dataset.tab}`));

    const meta = PAGE_META[tab.dataset.tab];
    if (meta) {
      $('#pageTitle').textContent = meta[0];
      $('#pageSub').textContent = meta[1];
    }

    if (tab.dataset.tab === 'orders' || tab.dataset.tab === 'customers') loadOrders();
    if (tab.dataset.tab === 'views') loadViews();
    if (tab.dataset.tab === 'abuse') loadAbuse();
  });
});

/* ---------------- دیالوگ ورودی متن (جایگزین prompt در Electron) ---------------- */
function askText(title, placeholder = '', initial = '') {
  return new Promise((resolve) => {
    $('#textModalTitle').textContent = title;
    const input = $('#textModalInput');
    input.placeholder = placeholder;
    input.value = initial;
    $('#textModal').classList.remove('hidden');
    const focusTimer = setTimeout(() => {
      if (!$('#textModal').classList.contains('hidden')) input.focus();
    }, 60);

    const finish = (value) => {
      clearTimeout(focusTimer);
      $('#textModal').classList.add('hidden');
      $('#textModalOk').onclick = null;
      $('#textModalCancel').onclick = null;
      $('#textModalClose').onclick = null;
      input.onkeydown = null;
      resolve(value);
    };

    $('#textModalOk').onclick = () => finish(input.value.trim() || null);
    $('#textModalCancel').onclick = () => finish(null);
    $('#textModalClose').onclick = () => finish(null);
    input.onkeydown = (event) => {
      if (event.key === 'Enter') finish(input.value.trim() || null);
      if (event.key === 'Escape') finish(null);
    };
  });
}

/* ---------------- دیالوگ تأیید ---------------- */
function askConfirm({
  title,
  message = '',
  detail = '',
  confirmText = 'تأیید',
  cancelText = 'انصراف',
  danger = false,
  icon = '⚠️',
} = {}) {
  return new Promise((resolve) => {
    const modal = $('#confirmModal');
    const ok = $('#confirmOk');
    const cancel = $('#confirmCancel');
    const detailEl = $('#confirmDetail');

    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = message;
    $('#confirmIcon').textContent = icon;
    detailEl.textContent = detail;
    detailEl.classList.toggle('hidden', !detail);
    ok.textContent = confirmText;
    cancel.textContent = cancelText;
    ok.className = `btn ${danger ? 'danger' : 'primary'}`;
    modal.querySelector('.confirm-box').classList.toggle('danger', danger);
    modal.classList.remove('hidden');

    let focusTimer = null;
    const finish = (value) => {
      clearTimeout(focusTimer);
      modal.classList.add('hidden');
      ok.onclick = null;
      cancel.onclick = null;
      modal.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') finish(false);
    };

    ok.onclick = () => finish(true);
    cancel.onclick = () => finish(false);
    modal.onclick = (event) => {
      if (event.target === modal) finish(false);
    };
    document.addEventListener('keydown', onKey);

    // برای عملیات مخرب، پیش‌فرض روی «انصراف» است تا با Enter اتفاقی تأیید نشود
    focusTimer = setTimeout(() => (danger ? cancel : ok).focus(), 60);
  });
}

/* ---------------- داده‌ها ---------------- */
async function loadProducts() {
  products = await api.listProducts();
  renderCategories();
  renderGrid();
  renderStats();
}

function renderStats() {
  const set = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };

  const totalStock = products.reduce((sum, p) => sum + effectiveStock(p), 0);
  const pending = orders.filter((o) => o.status === 'pending').length;
  const revenue = orders.filter((o) => o.status === 'done').reduce((sum, o) => sum + Number(o.total || 0), 0);

  set('#statProducts', products.length.toLocaleString('fa-IR'));
  set('#statStock', totalStock.toLocaleString('fa-IR'));
  set('#statPending', pending.toLocaleString('fa-IR'));
  set('#statRevenue', revenue.toLocaleString('fa-IR'));
}

async function loadCategories() {
  categories = await api.listCategories();
  renderCategories();
}

async function loadOptions() {
  [capacityOptions, shapeOptions, colorOptions] = await Promise.all([
    api.listOptions('capacity'),
    api.listOptions('shape'),
    api.listOptions('color'),
  ]);
  renderOptions();
}

function allCategoryNames() {
  return [...new Set([...categories, ...products.map((p) => p.category).filter(Boolean)])];
}

function renderCategories() {
  const filter = $('#filterCat');
  const current = filter.value;
  const names = allCategoryNames();
  filter.innerHTML = '<option value="">همه دسته‌ها</option>';
  names.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    filter.appendChild(opt);
  });
  filter.value = names.includes(current) ? current : '';

  const chips = $('#categoryList');
  chips.innerHTML = '';
  if (!categories.length) {
    const empty = document.createElement('span');
    empty.className = 'hint small';
    empty.textContent = 'هنوز دسته‌ای تعریف نشده است.';
    chips.appendChild(empty);
    return;
  }
  categories.forEach((name) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const label = document.createElement('span');
    label.textContent = name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.title = 'حذف دسته';
    remove.onclick = async () => {
      const confirmed = await askConfirm({
        title: 'حذف دسته‌بندی',
        message: `دسته «${name}» حذف شود؟ محصولات آن بدون تغییر می‌مانند.`,
        confirmText: 'حذف دسته',
        danger: true,
        icon: '🗂️',
      });
      if (!confirmed) return;
      categories = await api.removeCategory(name);
      renderCategories();
      renderGrid();
      toast('دسته حذف شد');
    };
    chip.append(label, remove);
    chips.appendChild(chip);
  });
}

/* ---------------- گرید محصولات ---------------- */
function priceLabel(product) {
  const prices = [Number(product.price) || 0, ...(product.sizes || []).map((s) => Number(s.price) || 0)].filter(
    (v) => v > 0
  );
  if (!prices.length) return 'قیمت نامشخص';
  const perSize = (product.sizes || []).some((s) => Number(s.price) > 0);
  return perSize ? `از ${money(Math.min(...prices))}` : money(prices[0]);
}

function sizeSummary(size) {
  return [size.label, size.capacity, size.shape].filter(Boolean).join(' • ');
}

/** موجودی کل: اگر ابعاد موجودی داشته باشند، جمع آن‌ها */
function effectiveStock(product) {
  const sized = (product.sizes || []).filter((s) => s.stock !== null && s.stock !== undefined);
  if (sized.length) return sized.reduce((sum, s) => sum + Number(s.stock || 0), 0);
  return Number(product.stock) || 0;
}

function renderGrid() {
  const q = $('#search').value.trim().toLowerCase();
  const cat = $('#filterCat').value;
  const list = products.filter((p) => {
    const matchQ = !q || [p.name, p.category, p.description, p.material].join(' ').toLowerCase().includes(q);
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
    else {
      thumb.classList.add('no-image');
      thumb.textContent = '🖼️';
    }

    const body = document.createElement('div');
    body.className = 'p-body';

    const name = document.createElement('div');
    name.className = 'p-name';
    name.textContent = p.name;

    const catEl = document.createElement('div');
    catEl.className = 'p-cat';
    catEl.textContent = [p.category, p.material].filter(Boolean).join(' • ') || 'بدون دسته';

    const price = document.createElement('div');
    price.className = 'p-price';
    price.textContent = priceLabel(p);

    const meta = document.createElement('div');
    meta.className = 'p-meta';
    const sizeCount = (p.sizes || []).length;
    const parts = [
      `موجودی: ${effectiveStock(p)}`,
      p.active === false ? '⛔ غیرفعال' : '✅ فعال',
      `${p.images?.length || 0} عکس`,
      sizeCount ? `${sizeCount} بُعد` : '',
      p.video ? '🎬 ویدیو' : '',
    ].filter(Boolean);
    parts.forEach((text) => {
      const span = document.createElement('span');
      span.textContent = text;
      meta.appendChild(span);
    });

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
      const confirmed = await askConfirm({
        title: 'حذف محصول',
        message: `«${p.name}» برای همیشه از کاتالوگ حذف شود؟`,
        detail: `${p.category || 'بدون دسته'} • موجودی ${effectiveStock(p)}`,
        confirmText: 'حذف محصول',
        danger: true,
        icon: '📦',
      });
      if (!confirmed) return;
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

/* ---------------- مودال محصول ---------------- */
function updatePriceStockVisibility() {
  // برای دسته «رومیزی» قیمت و موجودی فقط در ردیف‌های ابعاد ثبت می‌شود
  const hide = String($('#f-category').value || '').includes('رومیزی');
  $('#priceField').classList.toggle('hidden', hide);
  $('#stockField').classList.toggle('hidden', hide);
}

function fillCategorySelect(selected = '') {
  const select = $('#f-category');
  const names = [...new Set([...categories, ...(selected ? [selected] : [])])];
  select.innerHTML = '<option value="">بدون دسته</option>';
  names.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });
  select.value = selected || '';
}

$('#f-category').addEventListener('change', updatePriceStockVisibility);

function openModal(product = null) {
  editingId = product?.id ?? null;
  currentImages = product ? [...(product.images || [])] : [];
  currentVideo = product?.video || '';
  currentSizes = product
    ? (product.sizes || []).map((s) => ({
        label: s.label,
        capacity: s.capacity || '',
        shape: s.shape || '',
        color: s.color || '',
        price: s.price ?? null,
        stock: s.stock ?? null,
      }))
    : [];

  $('#modalTitle').textContent = product ? 'ویرایش محصول' : 'محصول جدید';
  $('#f-name').value = product?.name || '';
  fillCategorySelect(product?.category || '');
  updatePriceStockVisibility();
  $('#f-price').value = product?.price ?? '';
  $('#f-stock').value = product?.stock ?? 0;
  $('#f-material').value = product?.material || '';
  $('#f-colors').value = (product?.colors || []).join('، ');
  $('#f-description').value = product?.description || '';
  $('#f-active').checked = product ? product.active !== false : true;

  renderThumbs();
  renderVideo();
  renderSizes();
  $('#modal').classList.remove('hidden');

  // فوکوس روی اولین فیلد تا تایپ بلافاصله ممکن باشد
  setTimeout(() => {
    if (!$('#modal').classList.contains('hidden')) $('#f-name')?.focus();
  }, 80);
}

function closeModal() {
  $('#modal').classList.add('hidden');
  editingId = null;
  currentImages = [];
  currentVideo = '';
  currentSizes = [];
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

function renderVideo() {
  const box = $('#videoBox');
  box.innerHTML = '';
  if (!currentVideo) {
    const hint = document.createElement('span');
    hint.className = 'hint small';
    hint.textContent = 'بدون ویدیو';
    box.appendChild(hint);
    return;
  }

  const video = document.createElement('video');
  video.src = videoUrl(currentVideo);
  video.controls = true;

  const info = document.createElement('div');
  info.className = 'video-file';
  const text = document.createElement('span');
  text.textContent = 'ویدیو انتخاب شده';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn small danger-ghost';
  remove.textContent = 'حذف ویدیو';
  remove.onclick = async () => {
    await api.removeVideo(currentVideo);
    currentVideo = '';
    renderVideo();
  };
  info.append(text, remove);

  box.append(video, info);
}

/* ---------------- ابعاد با تعداد نفرات و شکل ---------------- */
function fillOptionSelect(select, list, selected) {
  select.innerHTML = '';

  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '—';
  select.appendChild(empty);

  // مقدار ذخیره‌شده ممکن است دیگر در لیست گزینه‌ها نباشد؛ باید همچنان نمایش داده شود
  const values = selected && !list.includes(selected) ? [...list, selected] : [...list];

  values.forEach((value) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  });

  const addNew = document.createElement('option');
  addNew.value = '__new__';
  addNew.textContent = '＋ گزینه جدید…';
  select.appendChild(addNew);

  select.value = selected || '';
}

const OPTION_META = {
  capacity: { title: 'گزینه جدید تعداد نفرات', placeholder: 'مثلاً ۴ نفره' },
  shape: { title: 'گزینه جدید شکل', placeholder: 'مثلاً دایره' },
  color: { title: 'گزینه جدید رنگ', placeholder: 'مثلاً کرم' },
};

function setOptionList(kind, list) {
  if (kind === 'capacity') capacityOptions = list;
  else if (kind === 'shape') shapeOptions = list;
  else colorOptions = list;
}

async function handleOptionSelect(select, kind, index) {
  if (select.value !== '__new__') {
    currentSizes[index][kind] = select.value;
    return;
  }

  const meta = OPTION_META[kind];
  const value = await askText(meta.title, meta.placeholder);

  if (!value) {
    select.value = currentSizes[index][kind] || '';
    return;
  }

  setOptionList(kind, await api.addOption(kind, value));
  currentSizes[index][kind] = value;
  renderOptions();
  renderSizes();
}

function renderSizes() {
  const wrap = $('#sizes');
  wrap.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'size-row size-head';
  ['ابعاد / اندازه', 'تعداد نفرات', 'شکل', 'رنگ', 'قیمت (تومان)', 'موجودی', ''].forEach((text) => {
    const span = document.createElement('span');
    span.textContent = text;
    head.appendChild(span);
  });
  wrap.appendChild(head);

  if (!currentSizes.length) {
    const hint = document.createElement('p');
    hint.className = 'hint small';
    hint.textContent = 'بدون بُعد — محصول فقط با قیمت پایه فروخته می‌شود.';
    wrap.appendChild(hint);
    return;
  }

  currentSizes.forEach((size, index) => {
    const row = document.createElement('div');
    row.className = 'size-row';

    const label = document.createElement('input');
    label.placeholder = 'مثلاً ۱۲۰×۱۸۰ سانتی‌متر';
    label.value = size.label || '';
    label.oninput = () => {
      currentSizes[index].label = label.value;
    };

    const capacity = document.createElement('select');
    fillOptionSelect(capacity, capacityOptions, size.capacity);
    capacity.onchange = () => handleOptionSelect(capacity, 'capacity', index);

    const shape = document.createElement('select');
    fillOptionSelect(shape, shapeOptions, size.shape);
    shape.onchange = () => handleOptionSelect(shape, 'shape', index);

    const color = document.createElement('select');
    fillOptionSelect(color, colorOptions, size.color);
    color.onchange = () => handleOptionSelect(color, 'color', index);

    const price = document.createElement('input');
    price.type = 'text';
    price.inputMode = 'numeric';
    price.placeholder = 'قیمت';
    price.value = size.price ?? '';
    price.oninput = () => {
      const value = num(price.value);
      currentSizes[index].price = value > 0 ? value : null;
    };

    const stock = document.createElement('input');
    stock.type = 'text';
    stock.inputMode = 'numeric';
    stock.placeholder = 'موجودی';
    stock.value = size.stock ?? '';
    stock.oninput = () => {
      currentSizes[index].stock = String(stock.value).trim() === '' ? null : Math.max(0, num(stock.value));
    };

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn small danger-ghost';
    remove.textContent = '✕';
    remove.onclick = () => {
      currentSizes.splice(index, 1);
      renderSizes();
    };

    row.append(label, capacity, shape, color, price, stock, remove);
    wrap.appendChild(row);
  });
}

$('#btnAddSize').onclick = () => {
  currentSizes.push({ label: '', capacity: '', shape: '', color: '', price: null, stock: null });
  renderSizes();
};

/* ---------------- گزینه‌های تعداد نفرات و شکل (تنظیمات) ---------------- */
function renderOptionChips(kind, list) {
  const wrap = $(`#${kind}List`);
  wrap.innerHTML = '';

  if (!list.length) {
    const hint = document.createElement('span');
    hint.className = 'hint small';
    hint.textContent = 'هنوز گزینه‌ای اضافه نشده است.';
    wrap.appendChild(hint);
    return;
  }

  list.forEach((value) => {
    const chip = document.createElement('span');
    chip.className = 'chip';

    const label = document.createElement('span');
    label.textContent = value;

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = '✎';
    edit.title = 'ویرایش گزینه';
    edit.onclick = async () => {
      const next = await askText('ویرایش گزینه', '', value);
      if (!next || next === value) return;
      setOptionList(kind, await api.renameOption(kind, value, next));
      renderOptions();
      if (!$('#modal').classList.contains('hidden')) renderSizes();
      toast('گزینه ویرایش شد');
    };

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.title = 'حذف گزینه';
    remove.onclick = async () => {
      const confirmed = await askConfirm({
        title: 'حذف گزینه',
        message: `گزینه «${value}» از لیست حذف شود؟`,
        detail: 'این گزینه فقط از لیست انتخاب‌ها پاک می‌شود و ابعاد ثبت‌شده محصولات تغییری نمی‌کنند.',
        confirmText: 'حذف گزینه',
        danger: true,
        icon: '🏷️',
      });
      if (!confirmed) return;
      setOptionList(kind, await api.removeOption(kind, value));
      renderOptions();
      toast('گزینه حذف شد');
    };

    chip.append(label, edit, remove);
    wrap.appendChild(chip);
  });
}

function renderOptions() {
  renderOptionChips('capacity', capacityOptions);
  renderOptionChips('shape', shapeOptions);
  renderOptionChips('color', colorOptions);
}

async function addOptionFromSettings(kind) {
  const inputId = { capacity: '#newCapacity', shape: '#newShape', color: '#newColor' }[kind];
  const input = $(inputId);
  const value = input.value.trim();
  if (!value) return toast('مقدار را وارد کنید', true);

  setOptionList(kind, await api.addOption(kind, value));
  input.value = '';
  renderOptions();
  toast('گزینه اضافه شد');
}

const OPTION_BUTTONS = { capacity: '#btnAddCapacity', shape: '#btnAddShape', color: '#btnAddColor' };
const OPTION_INPUTS = { capacity: '#newCapacity', shape: '#newShape', color: '#newColor' };

Object.keys(OPTION_BUTTONS).forEach((kind) => {
  $(OPTION_BUTTONS[kind]).onclick = () => addOptionFromSettings(kind);
  $(OPTION_INPUTS[kind]).addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addOptionFromSettings(kind);
  });
});

/* ---------------- تصاویر و ویدیو ---------------- */
$('#btnAddImages').onclick = async () => {
  const picked = await api.pickImages();
  if (picked.length) {
    currentImages = [...currentImages, ...picked];
    renderThumbs();
  }
};

$('#btnAddVideo').onclick = async () => {
  const picked = await api.pickVideo();
  if (picked) {
    if (currentVideo) await api.removeVideo(currentVideo);
    currentVideo = picked;
    renderVideo();
  }
};

$('#btnNewCat').onclick = async () => {
  const name = await askText('دسته‌بندی جدید', 'مثلاً کاور مبل');
  if (!name) return;
  try {
    categories = await api.addCategory(name);
    fillCategorySelect(name);
    updatePriceStockVisibility();
    renderCategories();
    renderGrid();
    toast('دسته اضافه شد');
  } catch (err) {
    toast(err.message || 'خطا در افزودن دسته', true);
  }
};

$('#btnSaveProduct').onclick = async () => {
  const payload = {
    id: editingId || undefined,
    name: $('#f-name').value.trim(),
    category: $('#f-category').value,
    price: num($('#f-price').value),
    stock: num($('#f-stock').value),
    material: $('#f-material').value.trim(),
    colors: $('#f-colors').value,
    description: $('#f-description').value.trim(),
    sizes: currentSizes.filter((s) => String(s.label || '').trim()),
    video: currentVideo,
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

/* ---------------- دسته‌بندی‌ها ---------------- */
$('#btnAddCategory').onclick = async () => {
  const input = $('#newCategory');
  const name = input.value.trim();
  if (!name) return toast('نام دسته را وارد کنید', true);
  try {
    categories = await api.addCategory(name);
    input.value = '';
    renderCategories();
    renderGrid();
    toast('دسته اضافه شد');
  } catch (err) {
    toast(err.message || 'خطا', true);
  }
};

$('#newCategory').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btnAddCategory').click();
});

/* ---------------- تنظیمات و ربات‌ها ---------------- */
const botStates = {
  telegram: { running: false, message: 'غیرفعال' },
  bale: { running: false, message: 'غیرفعال' },
};

function updateBotPill() {
  const pill = $('#botPill');
  const active = Object.entries(botStates)
    .filter(([, state]) => state.running)
    .map(([messenger]) => (messenger === 'bale' ? 'بله' : 'تلگرام'));
  pill.textContent = active.length ? `ربات‌ها: ${active.join(' + ')}` : 'ربات‌ها: غیرفعال';
  pill.classList.toggle('on', active.length > 0);
  pill.classList.toggle('off', active.length === 0);
}

function applyBotStatus(status) {
  const messenger = status?.messenger === 'bale' ? 'bale' : 'telegram';
  botStates[messenger] = { running: !!status?.running, message: status?.message || '' };

  const line = $(messenger === 'bale' ? '#bale-status' : '#tg-status');
  if (line) line.textContent = `وضعیت: ${status?.message || (status?.running ? 'فعال' : 'غیرفعال')}`;

  updateBotPill();
}

async function loadSettings() {
  const s = await api.getSettings();
  $('#s-shopName').value = s.shopName || '';
  $('#s-note').value = s.note || '';
  $('#s-shipping').value = s.shippingPrice || 0;
  $('#tg-token').value = s.telegram?.token || '';
  $('#tg-chat').value = s.telegram?.shopChatId || '';
  $('#tg-support').value = s.telegram?.supportUsername || 'MeadowSupport';
  $('#bale-token').value = s.bale?.token || '';
  $('#bale-chat').value = s.bale?.shopChatId || '';
  $('#bale-support').value = s.bale?.supportUsername || '';

  try {
    const statuses = await api.getBotStatuses();
    applyBotStatus({ messenger: 'telegram', ...(statuses.telegram || {}) });
    applyBotStatus({ messenger: 'bale', ...(statuses.bale || {}) });
  } catch {
    updateBotPill();
  }
}

$('#btnSaveSettings').onclick = async () => {
  const result = await api.saveSettings({
    shopName: $('#s-shopName').value,
    note: $('#s-note').value,
    shippingPrice: num($('#s-shipping').value),
    telegram: {
      token: $('#tg-token').value,
      shopChatId: $('#tg-chat').value,
      supportUsername: $('#tg-support').value,
    },
    bale: {
      token: $('#bale-token').value,
      shopChatId: $('#bale-chat').value,
      supportUsername: $('#bale-support').value,
    },
  });

  const statuses = result.botStatuses || {};
  applyBotStatus({ messenger: 'telegram', ...(statuses.telegram || {}) });
  applyBotStatus({ messenger: 'bale', ...(statuses.bale || {}) });
  toast('تنظیمات ذخیره شد');
};

async function startBot(messenger) {
  const status = await api.botStart(messenger);
  applyBotStatus({ messenger, ...status });
  toast(status.running ? 'ربات روشن شد' : status.message, !status.running);
}

async function stopBot(messenger) {
  const status = await api.botStop(messenger);
  applyBotStatus({ messenger, ...status });
  toast('ربات خاموش شد');
}

$('#tg-start').onclick = () => startBot('telegram');
$('#tg-stop').onclick = () => stopBot('telegram');
$('#bale-start').onclick = () => startBot('bale');
$('#bale-stop').onclick = () => stopBot('bale');

/* ---------------- سفارش‌ها ---------------- */
function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString('fa-IR');
  } catch {
    return '';
  }
}

function renderOrders(orders) {
  const wrap = $('#ordersList');
  wrap.innerHTML = '';
  $('#ordersEmpty').classList.toggle('hidden', orders.length > 0);

  orders.forEach((order) => {
    const card = document.createElement('article');
    card.className = 'order-card';

    const head = document.createElement('div');
    head.className = 'order-head';
    const code = document.createElement('div');
    code.className = 'order-code';
    code.textContent = `سفارش #${order.code}`;
    const statusMap = {
      done: ['ok', 'نهایی شده'],
      canceled: ['canceled', 'لغو شده'],
      pending: ['pending', 'در انتظار'],
    };
    const [badgeClass, badgeText] = statusMap[order.status] || statusMap.pending;
    const badge = document.createElement('span');
    badge.className = `badge ${badgeClass}`;
    badge.textContent = badgeText;
    head.append(code, badge);

    const meta = document.createElement('div');
    meta.className = 'order-meta';
    meta.textContent = `${formatDate(order.createdAt)} — ${order.customer.name} — ${order.customer.phone}`;

    const addr = document.createElement('div');
    addr.className = 'order-addr';
    addr.textContent = `📍 ${order.customer.address} — کد پستی: ${order.customer.postalCode}`;

    const list = document.createElement('ul');
    list.className = 'order-items';
    order.items.forEach((item) => {
      const li = document.createElement('li');
      const extra = [item.size, item.capacity, item.shape, ...(item.options || [])].filter(Boolean).join(' / ');
      li.textContent = `${item.name}${extra ? ` — ${extra}` : ''} × ${item.qty} = ${money(item.unitPrice * item.qty)}`;
      list.appendChild(li);
    });

    const total = document.createElement('div');
    total.className = 'order-total';
    total.textContent = `🚚 ارسال: ${order.shipping > 0 ? money(order.shipping) : 'رایگان'} | 💰 جمع کل: ${money(order.total)}`;

    card.append(head, meta, addr, list, total);

    if (order.status !== 'canceled') {
      const track = document.createElement('div');
      track.className = 'track-row';

      const input = document.createElement('input');
      input.placeholder = 'کد رهگیری پست';
      input.value = order.trackingCode || '';

      const send = document.createElement('button');
      send.className = 'btn small';
      send.textContent = order.trackingCode ? 'ویرایش و ارسال کد' : 'ثبت و ارسال کد به مشتری';
      send.onclick = async () => {
        const code = input.value.trim();
        if (!code) return toast('کد رهگیری را وارد کنید', true);
        const result = await api.setOrderTracking(order.id, code);
        toast(result.sent ? 'کد رهگیری برای مشتری ارسال شد' : 'کد ذخیره شد (ربات فعال نیست)', !result.sent);
        await loadOrders();
      };

      track.append(input, send);
      card.appendChild(track);
    }

    const actions = document.createElement('div');
    actions.className = 'order-actions';

    if (order.status === 'pending') {
      const cancel = document.createElement('button');
      cancel.className = 'btn small danger-ghost';
      cancel.textContent = 'لغو سفارش';
      cancel.onclick = () => openCancelModal(order);
      actions.appendChild(cancel);
    }

    const remove = document.createElement('button');
    remove.className = 'btn small danger-ghost';
    remove.textContent = 'حذف سفارش';
    remove.onclick = async () => {
      const confirmed = await askConfirm({
        title: 'حذف سفارش',
        message: `سفارش #${order.code} برای همیشه از لیست حذف شود؟ این عملیات قابل بازگشت نیست و پیامی برای مشتری ارسال نمی‌شود.`,
        detail: `${order.customer.name} • ${money(order.total)} • ${formatDate(order.createdAt)}`,
        confirmText: 'بله، حذف کن',
        danger: true,
        icon: '🗑️',
      });
      if (!confirmed) return;

      try {
        const deleted = await api.deleteOrder(order.id);
        if (!deleted) return toast('این سفارش پیدا نشد', true);
        toast('سفارش حذف شد');
        await loadOrders();
      } catch (err) {
        toast(err.message || 'خطا در حذف سفارش', true);
      }
    };
    actions.appendChild(remove);
    card.appendChild(actions);

    wrap.appendChild(card);
  });
}

async function loadOrders() {
  try {
    orders = await api.listOrders();
    renderOrders(orders);
    renderCustomers();
    renderStats();
  } catch (err) {
    toast(err.message || 'خطا در دریافت سفارش‌ها', true);
  }
}

$('#btnRefreshOrders').onclick = loadOrders;

/* ---------------- مشتریان (از سفارش‌های نهایی‌شده) ---------------- */
function renderCustomers() {
  const wrap = $('#customersList');
  if (!wrap) return;
  wrap.innerHTML = '';

  const map = new Map();
  for (const order of orders) {
    if (order.status !== 'done') continue;

    const key = order.chatId || order.customer?.phone || String(order.code);
    const entry = map.get(key) || { customer: order.customer || {}, orders: [], total: 0, lastAt: 0 };
    entry.orders.push(order);
    entry.total += Number(order.total || 0);
    entry.lastAt = Math.max(entry.lastAt, Number(order.createdAt) || 0);
    map.set(key, entry);
  }

  const customers = [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
  $('#customersEmpty')?.classList.toggle('hidden', customers.length > 0);

  customers.forEach((entry) => {
    const card = document.createElement('article');
    card.className = 'customer-card';

    const head = document.createElement('div');
    head.className = 'cust-head';

    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = String(entry.customer.name || '?').trim().charAt(0);

    const info = document.createElement('div');
    info.className = 'cust-info';
    const name = document.createElement('div');
    name.className = 'cust-name';
    name.textContent = entry.customer.name || 'مشتری';
    const meta = document.createElement('div');
    meta.className = 'cust-meta';
    meta.textContent = `${entry.customer.phone || '—'} • ${entry.orders.length} خرید • مجموع ${money(entry.total)}`;
    info.append(name, meta);

    const toggle = document.createElement('button');
    toggle.className = 'btn small';
    toggle.textContent = 'تاریخچه خرید';

    head.append(avatar, info, toggle);

    const details = document.createElement('div');
    details.className = 'cust-details hidden';

    const addr = document.createElement('div');
    addr.className = 'order-addr';
    addr.textContent = `📍 ${entry.customer.address || '—'} — کد پستی: ${entry.customer.postalCode || '—'}`;
    details.appendChild(addr);

    [...entry.orders]
      .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
      .forEach((order) => {
        const block = document.createElement('div');
        block.className = 'cust-order';

        const title = document.createElement('div');
        title.className = 'cust-order-head';
        title.textContent = `#${order.code} — ${formatDate(order.createdAt)} — ${money(order.total)}`;

        const list = document.createElement('ul');
        list.className = 'order-items';
        order.items.forEach((item) => {
          const li = document.createElement('li');
          const extra = [item.size, item.capacity, item.shape].filter(Boolean).join(' / ');
          li.textContent = `${item.name}${extra ? ` — ${extra}` : ''} × ${item.qty} = ${money(item.unitPrice * item.qty)}`;
          list.appendChild(li);
        });

        block.append(title, list);
        details.appendChild(block);
      });

    toggle.onclick = () => {
      details.classList.toggle('hidden');
      toggle.textContent = details.classList.contains('hidden') ? 'تاریخچه خرید' : 'بستن';
    };

    card.append(head, details);
    wrap.appendChild(card);
  });
}

$('#btnRefreshCustomers').onclick = loadOrders;

/* ---------------- لغو سفارش با دلیل ---------------- */
let pendingCancelOrder = null;

function openCancelModal(order) {
  pendingCancelOrder = order;
  $('#cancelReasonSelect').value = 'ناموجود بودن محصول';
  $('#cancelReasonText').value = '';
  $('#cancelModal').classList.remove('hidden');
}

function closeCancelModal() {
  $('#cancelModal').classList.add('hidden');
  pendingCancelOrder = null;
}

$('#cancelModalClose').onclick = closeCancelModal;
$('#cancelDismiss').onclick = closeCancelModal;
$('#cancelModal').addEventListener('click', (event) => {
  if (event.target.id === 'cancelModal') closeCancelModal();
});

$('#cancelConfirm').onclick = async () => {
  if (!pendingCancelOrder) return;

  const order = pendingCancelOrder;
  const base = $('#cancelReasonSelect').value;
  const extra = $('#cancelReasonText').value.trim();
  const reason = extra ? `${base} — ${extra}` : base;

  const updated = await api.cancelOrder(order.id, reason);
  closeCancelModal();

  if (!updated) return toast('امکان لغو این سفارش نیست', true);
  toast('سفارش لغو شد و دلیل برای مشتری ارسال شد');
  await loadOrders();
};

/* ---------------- بازدیدهای لیست محصول ---------------- */
function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function renderViews(views) {
  const wrap = $('#viewsList');
  if (!wrap) return;
  wrap.innerHTML = '';
  $('#viewsEmpty')?.classList.toggle('hidden', views.length > 0);

  const today = dateKey(new Date());
  const weekAgo = Date.now() - 7 * 86400000;

  $('#statViewsToday').textContent = views.filter((v) => v.date === today).length.toLocaleString('fa-IR');
  $('#statViewsWeek').textContent = views.filter((v) => Number(v.at) >= weekAgo).length.toLocaleString('fa-IR');
  $('#statViewsTotal').textContent = views.length.toLocaleString('fa-IR');

  const groups = new Map();
  views.forEach((view) => {
    if (!groups.has(view.date)) groups.set(view.date, []);
    groups.get(view.date).push(view);
  });

  [...groups.entries()].forEach(([date, list]) => {
    const card = document.createElement('article');
    card.className = 'view-card';

    const head = document.createElement('div');
    head.className = 'view-date';
    const title = document.createElement('span');
    title.textContent = date;
    const count = document.createElement('span');
    count.textContent = `${list.length} بازدید یکتا`;
    head.append(title, count);
    card.appendChild(head);

    [...list]
      .sort((a, b) => Number(b.at) - Number(a.at))
      .forEach((view) => {
        const row = document.createElement('div');
        row.className = 'view-row';

        const name = document.createElement('span');
        name.className = 'view-name';
        name.textContent = view.name || (view.username ? `@${view.username}` : `کاربر ${view.chatId}`);

        const meta = document.createElement('span');
        meta.className = 'view-meta';
        meta.textContent = view.username ? `@${view.username}` : new Date(view.at).toLocaleTimeString('fa-IR');

        row.append(name, meta);
        card.appendChild(row);
      });

    wrap.appendChild(card);
  });
}

async function loadViews() {
  try {
    renderViews(await api.listViews());
  } catch (err) {
    toast(err.message || 'خطا در دریافت بازدیدها', true);
  }
}

$('#btnRefreshViews').onclick = loadViews;

/* ---------------- گزارش تخلف ---------------- */
function renderAbuse(reports) {
  const wrap = $('#abuseList');
  if (!wrap) return;
  wrap.innerHTML = '';
  $('#abuseEmpty')?.classList.toggle('hidden', reports.length > 0);

  reports.forEach((report) => {
    const card = document.createElement('article');
    card.className = 'customer-card';

    const head = document.createElement('div');
    head.className = 'cust-head';

    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = String(report.name || report.username || '?').trim().charAt(0);

    const info = document.createElement('div');
    info.className = 'cust-info';

    const name = document.createElement('div');
    name.className = 'cust-name';
    name.textContent = report.name || (report.username ? `@${report.username}` : `کاربر ${report.chatId}`);

    const meta = document.createElement('div');
    meta.className = 'cust-meta';
    meta.textContent = [
      report.username ? `@${report.username}` : '',
      `شناسه: ${report.chatId}`,
      `${Number(report.count) || 0} اقدام`,
      formatDate(report.at),
    ]
      .filter(Boolean)
      .join(' • ');

    info.append(name, meta);

    const status = document.createElement('span');
    status.className = `abuse-status ${report.blocked ? 'blocked' : 'free'}`;
    status.textContent = report.blocked ? 'مسدود' : 'آزاد';

    head.append(avatar, info, status);

    const reason = document.createElement('div');
    reason.className = 'abuse-reason';
    reason.textContent = `دلیل گزارش: ${report.reason || 'رفتار مشکوک'}`;

    const actions = document.createElement('div');
    actions.className = 'order-actions';

    const action = document.createElement('button');
    action.className = `btn small ${report.blocked ? '' : 'danger-ghost'}`;
    action.textContent = report.blocked ? '✅ رفع مسدودی' : '🚫 بلاک از ربات';
    action.onclick = async () => {
      if (!report.blocked) {
        const confirmed = await askConfirm({
          title: 'مسدودسازی کاربر',
          message: `کاربر «${report.name || report.chatId}» از ربات بلاک شود؟`,
          detail: 'این کاربر دیگر نمی‌تواند از ربات خرید کند.',
          confirmText: 'بلاک کن',
          danger: true,
          icon: '🚫',
        });
        if (!confirmed) return;
      }

      const updated = report.blocked
        ? await api.unblockUser(report.chatId)
        : await api.blockUser(report.chatId, report.reason);

      renderAbuse(updated);
      toast(report.blocked ? 'کاربر آزاد شد' : 'کاربر بلاک شد');
    };

    actions.appendChild(action);
    card.append(head, reason, actions);
    wrap.appendChild(card);
  });
}

async function loadAbuse() {
  try {
    renderAbuse(await api.listAbuse());
  } catch (err) {
    toast(err.message || 'خطا در دریافت گزارش‌ها', true);
  }
}

$('#btnRefreshAbuse').onclick = loadAbuse;
api.onAbuseChanged(() => loadAbuse());

api.onBotStatus(applyBotStatus);
api.onProductsChanged(() => {
  loadProducts();
});

$('#btnOpenData').onclick = () => api.openDataDir();

/* ---------------- شروع ---------------- */
(async function init() {
  await loadOptions();
  await loadCategories();
  await loadProducts();
  await loadSettings();
  await loadOrders();
  await loadAbuse();
  try {
    const info = await api.getAppInfo();
    $('#appVersion').textContent = info.version;
    $('#sideVersion').textContent = `نسخه ${info.version}`;
  } catch {}
})();
