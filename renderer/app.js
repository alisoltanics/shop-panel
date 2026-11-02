'use strict';

// نکته: window.api توسط preload روی window ساخته می‌شود؛ اعلان «const api = ...»
// در اسکوپ گلوبال خطای redeclare می‌دهد، پس مستقیم از api گلوبال استفاده می‌کنیم.

const $ = (sel) => document.querySelector(sel);

let products = [];
let categories = [];
let capacityOptions = [];
let shapeOptions = [];
let currentImages = [];
let currentVideo = '';
let currentSizes = [];
let editingId = null;

const money = (n) => `${Number(n || 0).toLocaleString('fa-IR')} تومان`;
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
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab.dataset.tab}`));
    if (tab.dataset.tab === 'orders') loadOrders();
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
    setTimeout(() => input.focus(), 60);

    const finish = (value) => {
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

/* ---------------- داده‌ها ---------------- */
async function loadProducts() {
  products = await api.listProducts();
  renderCategories();
  renderGrid();
}

async function loadCategories() {
  categories = await api.listCategories();
  renderCategories();
}

async function loadOptions() {
  [capacityOptions, shapeOptions] = await Promise.all([api.listOptions('capacity'), api.listOptions('shape')]);
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
      if (!confirm(`دسته «${name}» حذف شود؟ محصولات آن بدون تغییر می‌مانند.`)) return;
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
    else thumb.textContent = '🖼️';

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
      `موجودی: ${Number(p.stock) || 0}`,
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

/* ---------------- مودال محصول ---------------- */
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

function openModal(product = null) {
  editingId = product?.id ?? null;
  currentImages = product ? [...(product.images || [])] : [];
  currentVideo = product?.video || '';
  currentSizes = product
    ? (product.sizes || []).map((s) => ({
        label: s.label,
        capacity: s.capacity || '',
        shape: s.shape || '',
        price: s.price ?? null,
        stock: s.stock ?? null,
      }))
    : [];

  $('#modalTitle').textContent = product ? 'ویرایش محصول' : 'محصول جدید';
  $('#f-name').value = product?.name || '';
  fillCategorySelect(product?.category || '');
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

async function handleOptionSelect(select, kind, index) {
  if (select.value !== '__new__') {
    currentSizes[index][kind] = select.value;
    return;
  }

  const title = kind === 'capacity' ? 'گزینه جدید تعداد نفرات' : 'گزینه جدید شکل';
  const placeholder = kind === 'capacity' ? 'مثلاً ۴ نفره' : 'مثلاً دایره';
  const value = await askText(title, placeholder);

  if (!value) {
    select.value = currentSizes[index][kind] || '';
    return;
  }

  const list = await api.addOption(kind, value);
  if (kind === 'capacity') capacityOptions = list;
  else shapeOptions = list;

  currentSizes[index][kind] = value;
  renderOptions();
  renderSizes();
}

function renderSizes() {
  const wrap = $('#sizes');
  wrap.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'size-row size-head';
  ['ابعاد / اندازه', 'تعداد نفرات', 'شکل', 'قیمت (تومان)', 'موجودی', ''].forEach((text) => {
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

    const price = document.createElement('input');
    price.type = 'number';
    price.min = '0';
    price.step = '1000';
    price.placeholder = 'قیمت';
    price.value = size.price ?? '';
    price.oninput = () => {
      currentSizes[index].price = Number(price.value) > 0 ? Number(price.value) : null;
    };

    const stock = document.createElement('input');
    stock.type = 'number';
    stock.min = '0';
    stock.step = '1';
    stock.placeholder = 'موجودی';
    stock.value = size.stock ?? '';
    stock.oninput = () => {
      currentSizes[index].stock = String(stock.value) === '' ? null : Math.max(0, Number(stock.value) || 0);
    };

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn small danger-ghost';
    remove.textContent = '✕';
    remove.onclick = () => {
      currentSizes.splice(index, 1);
      renderSizes();
    };

    row.append(label, capacity, shape, price, stock, remove);
    wrap.appendChild(row);
  });
}

$('#btnAddSize').onclick = () => {
  currentSizes.push({ label: '', capacity: '', shape: '', price: null, stock: null });
  renderSizes();
};

/* ---------------- گزینه‌های تعداد نفرات و شکل (تنظیمات) ---------------- */
function renderOptionChips(kind, list) {
  const wrap = kind === 'capacity' ? $('#capacityList') : $('#shapeList');
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
      const updated = await api.renameOption(kind, value, next);
      if (kind === 'capacity') capacityOptions = updated;
      else shapeOptions = updated;
      renderOptions();
      if (!$('#modal').classList.contains('hidden')) renderSizes();
      toast('گزینه ویرایش شد');
    };

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.title = 'حذف گزینه';
    remove.onclick = async () => {
      if (!confirm(`گزینه «${value}» حذف شود؟`)) return;
      const updated = await api.removeOption(kind, value);
      if (kind === 'capacity') capacityOptions = updated;
      else shapeOptions = updated;
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
}

async function addOptionFromSettings(kind) {
  const input = kind === 'capacity' ? $('#newCapacity') : $('#newShape');
  const value = input.value.trim();
  if (!value) return toast('مقدار را وارد کنید', true);

  const list = await api.addOption(kind, value);
  if (kind === 'capacity') capacityOptions = list;
  else shapeOptions = list;

  input.value = '';
  renderOptions();
  toast('گزینه اضافه شد');
}

$('#btnAddCapacity').onclick = () => addOptionFromSettings('capacity');
$('#btnAddShape').onclick = () => addOptionFromSettings('shape');
$('#newCapacity').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btnAddCapacity').click();
});
$('#newShape').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btnAddShape').click();
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
    price: Number($('#f-price').value) || 0,
    stock: Number($('#f-stock').value) || 0,
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

/* ---------------- تنظیمات و ربات ---------------- */
const MESSENGER_HELP = {
  telegram:
    '۱) در تلگرام به @BotFather پیام بدهید، دستور /newbot را بزنید و توکن ربات را کپی کنید. ۲) با اکانت تلگرام فروشگاه، ربات را باز کنید، /start بدهید و بعد /id بفرستید؛ عددی که نشان می‌دهد «چت آیدی فروشگاه» است. ۳) توکن و چت آیدی را همین‌جا وارد و ذخیره کنید؛ ربات خودکار روشن می‌شود.',
  bale:
    '۱) در پیام‌رسان بله به @BotFather پیام بدهید، ربات بسازید و توکن را کپی کنید. ۲) با اکانت بله فروشگاه، همان ربات را باز کنید، /start بدهید و سپس /id بفرستید تا «چت آیدی فروشگاه» را بگیرید. ۳) پیام‌رسان را روی «بله» بگذارید، توکن و چت آیدی را ذخیره کنید.',
};

function updateMessengerHelp() {
  const messenger = $('#s-messenger').value === 'bale' ? 'bale' : 'telegram';
  $('#messengerHelp').textContent = MESSENGER_HELP[messenger];
}

async function loadSettings() {
  const s = await api.getSettings();
  $('#s-shopName').value = s.shopName || '';
  $('#s-note').value = s.note || '';
  $('#s-shipping').value = s.shippingPrice || 0;
  $('#s-messenger').value = s.messenger || 'telegram';
  $('#s-botToken').value = s.botToken || '';
  $('#s-shopChatId').value = s.shopChatId || '';
  $('#s-support').value = s.supportUsername || 'MeadowSupport';
  updateMessengerHelp();
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

$('#s-messenger').addEventListener('change', updateMessengerHelp);

$('#btnSaveSettings').onclick = async () => {
  const { botStatus } = await api.saveSettings({
    shopName: $('#s-shopName').value,
    note: $('#s-note').value,
    shippingPrice: $('#s-shipping').value,
    messenger: $('#s-messenger').value,
    botToken: $('#s-botToken').value,
    shopChatId: $('#s-shopChatId').value,
    supportUsername: $('#s-support').value,
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
    const badge = document.createElement('span');
    badge.className = `badge ${order.status === 'done' ? 'ok' : 'pending'}`;
    badge.textContent = order.status === 'done' ? 'نهایی شده' : 'در انتظار';
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
    wrap.appendChild(card);
  });
}

async function loadOrders() {
  try {
    renderOrders(await api.listOrders());
  } catch (err) {
    toast(err.message || 'خطا در دریافت سفارش‌ها', true);
  }
}

$('#btnRefreshOrders').onclick = loadOrders;

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
  try {
    const info = await api.getAppInfo();
    $('#appVersion').textContent = info.version;
  } catch {}
})();
