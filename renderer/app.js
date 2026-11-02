'use strict';

// نکته: window.api توسط preload روی window ساخته می‌شود و اعلان «const api = ...»
// در اسکوپ گلوبال خطای redeclare می‌دهد؛ پس مستقیم از api گلوبال استفاده می‌کنیم.

const $ = (sel) => document.querySelector(sel);

let products = [];
let categories = [];
let currentImages = [];
let currentVideo = '';
let currentSizes = [];
let currentAttrs = [];
let currentVariantPrices = {};
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
  });
});

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
      (p.attributes || []).length ? `${(p.attributes || []).length} ویژگی` : '',
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
  currentSizes = product ? (product.sizes || []).map((s) => ({ label: s.label, price: s.price })) : [];
  currentAttrs = (product?.attributes || []).map((a) => ({ name: a.name, optionsText: (a.options || []).join('، ') }));
  currentVariantPrices = { ...(product?.variantPrices || {}) };

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
  renderAttrs();
  renderVariants();
  $('#modal').classList.remove('hidden');
}

function closeModal() {
  $('#modal').classList.add('hidden');
  editingId = null;
  currentImages = [];
  currentVideo = '';
  currentSizes = [];
  currentAttrs = [];
  currentVariantPrices = {};
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

function renderSizes() {
  const wrap = $('#sizes');
  wrap.innerHTML = '';
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
    label.placeholder = 'مثلاً ۲ در ۱.۵ متر';
    label.value = size.label || '';
    label.oninput = () => {
      currentSizes[index].label = label.value;
    };

    const price = document.createElement('input');
    price.type = 'number';
    price.min = '0';
    price.step = '1000';
    price.placeholder = 'قیمت (اختیاری)';
    price.value = size.price ?? '';
    price.oninput = () => {
      currentSizes[index].price = Number(price.value) > 0 ? Number(price.value) : null;
    };

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn small danger-ghost';
    remove.textContent = '✕';
    remove.onclick = () => {
      currentSizes.splice(index, 1);
      renderSizes();
    };

    row.append(label, price, remove);
    wrap.appendChild(row);
  });
}

$('#btnAddSize').onclick = () => {
  currentSizes.push({ label: '', price: null });
  renderSizes();
};

/* ---------------- ویژگی‌ها و قیمت ترکیب گزینه‌ها ---------------- */
function parsedAttrs() {
  return currentAttrs
    .map((a) => ({
      name: String(a.name || '').trim(),
      options: String(a.optionsText || '')
        .split(/[,،]/)
        .map((o) => o.trim())
        .filter(Boolean),
    }))
    .filter((a) => a.name && a.options.length);
}

function combosOf(attrs) {
  let combos = [{ key: '', labels: [] }];
  for (const attr of attrs) {
    const next = [];
    for (const combo of combos) {
      attr.options.forEach((option, index) => {
        next.push({ key: combo.key ? `${combo.key}-${index}` : String(index), labels: [...combo.labels, option] });
      });
    }
    combos = next;
    if (combos.length > 60) return [];
  }
  return combos;
}

function renderAttrs() {
  const wrap = $('#attrs');
  wrap.innerHTML = '';
  if (!currentAttrs.length) {
    const hint = document.createElement('p');
    hint.className = 'hint small';
    hint.textContent = 'بدون ویژگی — می‌توانید مثل «شکل» یا «ظرفیت» اضافه کنید.';
    wrap.appendChild(hint);
    return;
  }

  currentAttrs.forEach((attr, index) => {
    const row = document.createElement('div');
    row.className = 'attr-row';

    const name = document.createElement('input');
    name.className = 'attr-name';
    name.placeholder = 'نام ویژگی';
    name.value = attr.name || '';
    name.oninput = () => {
      currentAttrs[index].name = name.value;
      renderVariants();
    };

    const options = document.createElement('input');
    options.className = 'attr-options';
    options.placeholder = 'گزینه‌ها با کاما: دایره‌ای، مستطیلی';
    options.value = attr.optionsText || '';
    options.oninput = () => {
      currentAttrs[index].optionsText = options.value;
      renderVariants();
    };

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn small danger-ghost';
    remove.textContent = '✕';
    remove.onclick = () => {
      currentAttrs.splice(index, 1);
      renderAttrs();
      renderVariants();
    };

    row.append(name, options, remove);
    wrap.appendChild(row);
  });
}

function renderVariants() {
  const section = $('#variantSection');
  const wrap = $('#variants');
  wrap.innerHTML = '';

  const attrs = parsedAttrs();
  if (!attrs.length) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  const combos = combosOf(attrs);
  if (!combos.length) {
    wrap.innerHTML = '<p class="hint small">تعداد ترکیب‌ها زیاد است؛ قیمت همه گزینه‌ها از قیمت پایه/بُعد استفاده می‌کند.</p>';
    return;
  }

  combos.forEach((combo) => {
    const row = document.createElement('div');
    row.className = 'variant-row';

    const label = document.createElement('span');
    label.textContent = combo.labels.join(' / ');

    const price = document.createElement('input');
    price.type = 'number';
    price.min = '0';
    price.step = '1000';
    price.placeholder = 'قیمت (اختیاری)';
    price.value = currentVariantPrices[combo.key] ?? '';
    price.oninput = () => {
      const value = Number(price.value);
      if (value > 0) currentVariantPrices[combo.key] = value;
      else delete currentVariantPrices[combo.key];
    };

    row.append(label, price);
    wrap.appendChild(row);
  });
}

$('#btnAddAttr').onclick = () => {
  currentAttrs.push({ name: '', optionsText: '' });
  renderAttrs();
  renderVariants();
};

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
  const name = prompt('نام دسته جدید:');
  if (!name || !name.trim()) return;
  categories = await api.addCategory(name);
  fillCategorySelect(name.trim());
  renderCategories();
  toast('دسته اضافه شد');
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
    attributes: parsedAttrs(),
    variantPrices: { ...currentVariantPrices },
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
api.onProductsChanged(() => {
  loadProducts();
});

$('#btnOpenData').onclick = () => api.openDataDir();

/* ---------------- شروع ---------------- */
(async function init() {
  await loadCategories();
  await loadProducts();
  await loadSettings();
  try {
    const info = await api.getAppInfo();
    $('#appVersion').textContent = info.version;
  } catch {}
})();
