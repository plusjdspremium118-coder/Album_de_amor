'use strict';

/* ═══════════════════════════════════════
   1. SEGURIDAD (Anti-XSS)
   ═══════════════════════════════════════ */
const Sanitizer = {
  clean(str) {
    if (typeof str !== 'string') return '';
    const el = document.createElement('div');
    el.textContent = str;
    return el.innerHTML;
  },
  setTextSafe(el, text) {
    if (el) el.textContent = typeof text === 'string' ? text : '';
  }
};

/* ═══════════════════════════════════════
   2. BASE DE DATOS (Supabase)
   ═══════════════════════════════════════ */
class AlbumDB {
  constructor() {
    // Inicializar cliente de Supabase (las credenciales deben coincidir con las tuyas)
    const supabaseUrl = 'https://nnprxywyrczeeebmieqp.supabase.co';
    const supabaseKey = 'sb_publishable_oKDib_AM9fbvFWOnJUG7Pw_1MWu-ZYf';
    this.client = supabase.createClient(supabaseUrl, supabaseKey);
  }

  async init() {
    return Promise.resolve(true);
  }

  async addFoto(data) {
    const { file, tipo, descripcion, fecha } = data;
    let imageUrl = '';

    // Si hay un archivo (File) subimos a Storage
    if (file) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `memorias/${fileName}`;

      const { error: uploadError } = await this.client.storage
        .from('album-media')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = this.client.storage
        .from('album-media')
        .getPublicUrl(filePath);
      
      imageUrl = publicUrlData.publicUrl;
    }

    // Insertar en la base de datos (tabla fotos)
    const { data: dbData, error: dbError } = await this.client
      .from('fotos')
      .insert([
        { imagen: imageUrl, tipo, descripcion, fecha }
      ])
      .select();

    if (dbError) throw dbError;
    return dbData[0].id;
  }

  async getAllFotos() {
    const { data, error } = await this.client
      .from('fotos')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async deleteFoto(id) {
    // Obtener la URL para borrar de storage
    const { data: fotoData } = await this.client.from('fotos').select('imagen').eq('id', id).single();
    
    if (fotoData && fotoData.imagen) {
      const urlParts = fotoData.imagen.split('/album-media/');
      if(urlParts.length > 1) {
        const filePath = urlParts[1];
        await this.client.storage.from('album-media').remove([filePath]);
      }
    }

    // Borrar de la tabla
    const { error } = await this.client.from('fotos').delete().eq('id', id);
    if (error) throw error;
  }

  async setConfig(clave, valor) {
    const { error } = await this.client
      .from('configuracion')
      .upsert({ clave, valor });
    if (error) throw error;
  }

  async getConfig(clave) {
    const { data, error } = await this.client
      .from('configuracion')
      .select('valor')
      .eq('clave', clave)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 ignora "no rows"
    return data ? data.valor : null;
  }

  // --- CARTAS ---
  async addCarta(data) {
    const { error } = await this.client
      .from('cartas')
      .insert([data]);
    if (error) throw error;
  }

  async getAllCartas() {
    const { data, error } = await this.client
      .from('cartas')
      .select('*')
      .order('id', { ascending: true });
    
    if (error) throw error;
    return data || [];
  }
}

/* ═══════════════════════════════════════
   3. TOAST NOTIFICATIONS
   ═══════════════════════════════════════ */
function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  Sanitizer.setTextSafe(t, msg);
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
}

/* ═══════════════════════════════════════
   4. SISTEMA DE PIN Y PANTALLA DE BLOQUEO
   ═══════════════════════════════════════ */
const PinSystem = {
  correctPin: '3126',
  currentInput: '',
  isUnlocked: false,

  init() {
    // Verificar si ya está desbloqueado en la sesión
    if (sessionStorage.getItem('album_unlocked') === 'true') {
      this.unlock(false);
      return;
    }

    this.startSunflowerRain();
    
    document.querySelectorAll('.pin-btn[data-num]').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleInput(e.target.dataset.num));
    });
    
    document.getElementById('pin-delete').addEventListener('click', () => this.handleDelete());
  },

  handleInput(num) {
    if (this.currentInput.length < 4) {
      this.currentInput += num;
      this.updateDots();
      
      if (this.currentInput.length === 4) {
        setTimeout(() => this.checkPin(), 300);
      }
    }
  },

  handleDelete() {
    if (this.currentInput.length > 0) {
      this.currentInput = this.currentInput.slice(0, -1);
      this.updateDots();
      document.getElementById('pin-error').hidden = true;
    }
  },

  updateDots() {
    const dots = document.querySelectorAll('.pin-dot');
    dots.forEach((dot, index) => {
      if (index < this.currentInput.length) dot.classList.add('filled');
      else dot.classList.remove('filled');
    });
  },

  checkPin() {
    if (this.currentInput === this.correctPin) {
      sessionStorage.setItem('album_unlocked', 'true');
      this.unlock(true);
    } else {
      const errorEl = document.getElementById('pin-error');
      errorEl.hidden = false;
      errorEl.style.animation = 'none';
      errorEl.offsetHeight; // Trigger reflow
      errorEl.style.animation = 'shake 0.4s ease-in-out';
      
      setTimeout(() => {
        this.currentInput = '';
        this.updateDots();
      }, 500);
    }
  },

  unlock(withAnimation) {
    this.isUnlocked = true;
    const lockScreen = document.getElementById('lock-screen');
    const app = document.getElementById('app');
    
    if (withAnimation) {
      // Bloom Animation
      const bloom = document.getElementById('bloom-overlay');
      bloom.hidden = false;
      
      // Crear algunas flores explotando
      for(let i=0; i<15; i++) {
        const f = document.createElement('div');
        f.className = 'bloom-flower';
        f.textContent = ['🌻', '🌼', '💛', '✨'][Math.floor(Math.random()*4)];
        f.style.setProperty('--tx', (Math.random() - 0.5) * 1000 + 'px');
        f.style.setProperty('--ty', (Math.random() - 0.5) * 1000 + 'px');
        f.style.setProperty('--s', 2 + Math.random() * 3);
        f.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
        bloom.appendChild(f);
      }

      requestAnimationFrame(() => bloom.classList.add('active'));

      setTimeout(() => {
        lockScreen.style.opacity = '0';
        lockScreen.style.visibility = 'hidden';
        app.hidden = false;
        
        setTimeout(() => {
          bloom.classList.remove('active');
          setTimeout(() => bloom.hidden = true, 1500);
        }, 800);
      }, 500);
    } else {
      lockScreen.hidden = true;
      app.hidden = false;
    }
  },

  startSunflowerRain() {
    const rainContainer = document.getElementById('sunflower-rain');
    if (!rainContainer) return;

    setInterval(() => {
      if (this.isUnlocked) return;
      const flower = document.createElement('div');
      flower.className = 'falling-sunflower';
      flower.textContent = '🌻';
      flower.style.left = Math.random() * 100 + 'vw';
      flower.style.setProperty('--dur', 8 + Math.random() * 6 + 's');
      flower.style.setProperty('--size', 2.5 + Math.random() * 1.5 + 'rem');
      flower.style.setProperty('--rot', (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 360) + 'deg');
      
      rainContainer.appendChild(flower);
      
      // Remove after animation
      setTimeout(() => flower.remove(), 15000);
    }, 800);
  }
};

/* ═══════════════════════════════════════
   5. DECORACIONES DEL ÁLBUM
   ═══════════════════════════════════════ */
const AlbumDecorations = {
  init() {
    document.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('.modal-content')) return;
      
      const container = document.getElementById('click-floats');
      if (!container) return;

      const f = document.createElement('div');
      f.className = 'float-item';
      f.textContent = Math.random() > 0.5 ? '🌻' : '💛';
      f.style.left = e.clientX + 'px';
      f.style.top = e.clientY + 'px';
      
      container.appendChild(f);
      setTimeout(() => f.remove(), 2000);
    });
  }
};

/* ═══════════════════════════════════════
   6. CONTADOR DE TIEMPO
   ═══════════════════════════════════════ */
const Counter = {
  intervalId: null,
  startDate: null,

  start(dateStr) {
    this.startDate = new Date(dateStr + 'T00:00:00');
    if (this.intervalId) clearInterval(this.intervalId);
    this.update();
    this.intervalId = setInterval(() => this.update(), 1000);
  },

  update() {
    if (!this.startDate) return;
    const now = new Date();
    let years = now.getFullYear() - this.startDate.getFullYear();
    let months = now.getMonth() - this.startDate.getMonth();
    let days = now.getDate() - this.startDate.getDate();
    let hours = now.getHours() - this.startDate.getHours();
    let minutes = now.getMinutes() - this.startDate.getMinutes();
    let seconds = now.getSeconds() - this.startDate.getSeconds();

    if (seconds < 0) { seconds += 60; minutes--; }
    if (minutes < 0) { minutes += 60; hours--; }
    if (hours < 0) { hours += 24; days--; }
    if (days < 0) {
      const prev = new Date(now.getFullYear(), now.getMonth(), 0);
      days += prev.getDate(); months--;
    }
    if (months < 0) { months += 12; years--; }

    Sanitizer.setTextSafe(document.getElementById('counter-years'), String(years));
    Sanitizer.setTextSafe(document.getElementById('counter-months'), String(months));
    Sanitizer.setTextSafe(document.getElementById('counter-days'), String(days));
    Sanitizer.setTextSafe(document.getElementById('counter-hours'), String(hours));
    Sanitizer.setTextSafe(document.getElementById('counter-minutes'), String(minutes));
    Sanitizer.setTextSafe(document.getElementById('counter-seconds'), String(seconds));

    const totalDays = Math.floor((now - this.startDate) / 86400000);
    const el = document.getElementById('counter-total-days');
    Sanitizer.setTextSafe(el, totalDays > 0 ? `${totalDays} días de amor y contando...` : '');
  },

  getTotalDays() {
    if (!this.startDate) return 0;
    return Math.max(0, Math.floor((new Date() - this.startDate) / 86400000));
  }
};

/* ═══════════════════════════════════════
   7. CEREZO EN CANVAS (Se mantiene el original por requisito)
   ═══════════════════════════════════════ */
const SakuraCanvas = {
  canvas: null, ctx: null, width: 0, height: 0,
  branchTips: [], petals: [], animId: null,

  offCanvas: null, offCtx: null,

  init() {
    this.canvas = document.getElementById('sakura-canvas');
    if(!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    
    this.offCanvas = document.createElement('canvas');
    this.offCtx = this.offCanvas.getContext('2d');

    this.resize();
    window.addEventListener('resize', () => { 
      this.resize(); 
      this.preRender(); 
    });
  },

  resize() {
    // Tomar el ancho exacto del contenido ignorando el padding del wrapper
    const w = this.canvas.clientWidth || this.canvas.parentElement.clientWidth - 10;
    const h = Math.max(280, Math.min(w * 0.7, 450));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    // Eliminamos el width fijo en JS para que CSS respete el 100% y no desborde
    this.canvas.style.height = h + 'px';
    
    this.offCanvas.width = w * dpr;
    this.offCanvas.height = h * dpr;
    
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    
    this.width = w; this.height = h;
  },

  seededRandom(seed) {
    let s = seed;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  },

  generateTree(ctx) {
    this.branchTips = [];
    const rand = this.seededRandom(42);
    const tips = this.branchTips;
    const baseX = this.width / 2;
    const baseY = this.height;

    // Escalar un poco el árbol según el ancho de la pantalla
    const isMobile = this.width < 500;
    const branchMult = isMobile ? 1.0 : 1.5;

    ctx.shadowBlur = isMobile ? 2 : 4;
    ctx.shadowColor = 'rgba(0,0,0,0.3)';

    const drawBranch = (x, y, angle, len, depth, maxD) => {
      if (depth === 0 || len < 3) { tips.push({ x, y }); return; }
      
      const curve = (rand() - 0.5) * 0.3;
      angle += curve;

      const ex = x + Math.cos(angle) * len;
      const ey = y + Math.sin(angle) * len;
      
      ctx.beginPath();
      ctx.moveTo(x, y); 
      const cpX = x + Math.cos(angle - curve) * (len * 0.6);
      const cpY = y + Math.sin(angle - curve) * (len * 0.6);
      ctx.quadraticCurveTo(cpX, cpY, ex, ey);

      ctx.strokeStyle = depth > maxD * 0.6 ? '#3b2518' : '#4d3322';
      ctx.lineWidth = Math.max(1, depth * branchMult);
      ctx.lineCap = 'round';
      ctx.stroke();

      const spread = 0.3 + rand() * 0.25;
      const shrink = 0.72 + rand() * 0.08; 
      drawBranch(ex, ey, angle - spread, len * shrink, depth - 1, maxD);
      drawBranch(ex, ey, angle + spread, len * shrink, depth - 1, maxD);
    };

    const initialLen = isMobile ? this.height * 0.22 : this.height * 0.25;
    drawBranch(baseX, baseY, -Math.PI / 2, initialLen, 9, 9);
    ctx.shadowBlur = 0;
  },

  drawSunflower(ctx, x, y, size, rotation) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);

    const petalCount = 12;
    ctx.fillStyle = '#f8cd24'; 
    for (let i = 0; i < petalCount; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI * 2) / petalCount);
      ctx.beginPath();
      ctx.ellipse(0, -size * 0.55, size * 0.25, size * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(0, 0, size * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#4a2b0f';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, size * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = '#301c0a';
    ctx.fill();

    ctx.restore();
  },

  drawFlowers(ctx, count) {
    const rand = this.seededRandom(123);
    const tips = this.branchTips;
    const n = Math.min(count, tips.length);

    // Ajustar el tamaño base de los girasoles según la pantalla
    const baseSize = this.width < 500 ? 7 : 5;
    const varSize = this.width < 500 ? 5 : 7;

    for (let i = 0; i < n; i++) {
      const t = tips[i % tips.length];
      const size = baseSize + rand() * varSize;
      const rot = rand() * Math.PI * 2;
      this.drawSunflower(ctx, t.x, t.y, size, rot);
    }
  },

  preRender() {
    if (!this.offCtx) return;
    const totalDays = Counter.getTotalDays();
    this.offCtx.clearRect(0, 0, this.width, this.height);
    this.generateTree(this.offCtx);
    if (totalDays > 0) this.drawFlowers(this.offCtx, totalDays);
    
    const caption = document.getElementById('sakura-caption');
    if (caption) {
      if (totalDays > 0) Sanitizer.setTextSafe(caption, `🌻 ${totalDays} días llenos de amor y crecimiento`);
      else Sanitizer.setTextSafe(caption, 'Configura la fecha para ver florecer nuestros girasoles');
    }
  },

  initPetals() {
    this.petals = [];
    for (let i = 0; i < 25; i++) {
      this.petals.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        size: 2 + Math.random() * 3,
        speedY: 0.6 + Math.random() * 1.2,
        speedX: (Math.random() - 0.5) * 1.5,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.02 + Math.random() * 0.04
      });
    }
  },

  animatePetals() {
    const ctx = this.ctx;
    for (const p of this.petals) {
      p.y += p.speedY;
      p.x += p.speedX + Math.sin(p.wobble) * 0.5;
      p.wobble += p.wobbleSpeed;
      
      if (p.y > this.height + 15) { 
        p.y = -15; 
        p.x = Math.random() * this.width; 
      }
      if (p.x < -15) p.x = this.width + 15;
      if (p.x > this.width + 15) p.x = -15;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.wobble);
      
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size * 0.5, p.size, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(248, 205, 36, 0.75)';
      ctx.fill();
      ctx.restore();
    }
  },

  startAnimation() {
    this.preRender();
    this.initPetals();
    const loop = () => {
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.ctx.drawImage(this.offCanvas, 0, 0, this.width, this.height);
      this.animatePetals();
      this.animId = requestAnimationFrame(loop);
    };
    if(this.animId) cancelAnimationFrame(this.animId);
    this.animId = requestAnimationFrame(loop);
  }
};

/* ═══════════════════════════════════════
   8. GESTIÓN DE GALERÍA Y MEDIOS
   ═══════════════════════════════════════ */
function createCartaElement(carta) {
  const article = document.createElement('article');
  article.className = `love-note ${carta.estilo || 'note-1'}`;

  // Accesorio visual según estilo
  if (carta.estilo === 'note-2') {
    const tape = document.createElement('div');
    tape.className = 'tape tape-top';
    tape.style.setProperty('--tape-rot', '2deg');
    article.appendChild(tape);
  } else {
    const pin = document.createElement('div');
    pin.className = 'note-pin';
    article.appendChild(pin);
  }

  const p = document.createElement('p');
  p.className = 'note-text';
  p.textContent = `"${carta.texto}"`;

  const span = document.createElement('span');
  span.className = 'note-signature';
  span.textContent = carta.firma;

  article.appendChild(p);
  article.appendChild(span);
  
  return article;
}

function renderCartas(cartas) {
  const container = document.getElementById('notes-grid');
  if (!container) return;
  container.innerHTML = '';
  
  // Si no hay cartas en DB, mostrar un mensaje de que se puede empezar a escribir
  if (cartas.length === 0) {
    container.innerHTML = '<p style="text-align:center; width:100%; color:var(--gold-main);">Aún no hay cartas. ¡Escribe la primera!</p>';
    return;
  }

  cartas.forEach(c => {
    container.appendChild(createCartaElement(c));
  });
}

function createPhotoCard(foto) {
  const card = document.createElement('article');
  card.className = 'photo-card';
  const rot = ((foto.id * 7 + 3) % 7 - 3).toFixed(1);
  const tapeRot = ((foto.id * 3 + 1) % 5 - 2).toFixed(1);
  card.style.setProperty('--rotation', rot + 'deg');
  card.style.setProperty('--tape-rot', tapeRot + 'deg');
  card.dataset.id = foto.id;

  const inner = document.createElement('div');
  inner.className = 'photo-card-inner';

  const tape = document.createElement('div');
  tape.className = 'tape';
  inner.appendChild(tape);

  if (foto.tipo && foto.tipo.startsWith('video/')) {
    const vid = document.createElement('video');
    vid.className = 'photo-card-media';
    vid.src = foto.imagen;
    vid.muted = true;
    vid.loop = true;
    vid.autoplay = true;
    inner.appendChild(vid);
  } else {
    const img = document.createElement('img');
    img.className = 'photo-card-media';
    img.src = foto.imagen;
    img.alt = Sanitizer.clean(foto.descripcion || 'Recuerdo');
    img.loading = 'lazy';
    inner.appendChild(img);
  }

  if (foto.descripcion) {
    const desc = document.createElement('p');
    desc.className = 'photo-card-desc';
    Sanitizer.setTextSafe(desc, foto.descripcion);
    inner.appendChild(desc);
  }

  if (foto.fecha) {
    const date = document.createElement('span');
    date.className = 'photo-card-date';
    Sanitizer.setTextSafe(date, foto.fecha);
    inner.appendChild(date);
  }

  card.appendChild(inner);
  card.addEventListener('click', () => openViewer(foto));
  return card;
}

function openViewer(foto) {
  const modal = document.getElementById('modal-viewer');
  const imgEl = document.getElementById('viewer-image');
  const vidEl = document.getElementById('viewer-video');
  
  if (foto.tipo && foto.tipo.startsWith('video/')) {
    imgEl.hidden = true;
    vidEl.hidden = false;
    vidEl.src = foto.imagen;
    vidEl.play();
  } else {
    vidEl.hidden = true;
    vidEl.pause();
    imgEl.hidden = false;
    imgEl.src = foto.imagen;
    imgEl.alt = Sanitizer.clean(foto.descripcion || 'Foto');
  }

  Sanitizer.setTextSafe(document.getElementById('viewer-description'), foto.descripcion || '');
  Sanitizer.setTextSafe(document.getElementById('viewer-date'), foto.fecha ? `📅 ${foto.fecha}` : '');
  document.getElementById('btn-delete-photo').dataset.id = foto.id;
  openModal(modal);
}

function renderGallery(fotos) {
  const grid = document.getElementById('gallery-grid');
  const empty = document.getElementById('gallery-empty');
  grid.replaceChildren();
  if (fotos.length === 0) {
    empty.hidden = false;
  } else {
    empty.hidden = true;
    // Render in reverse to show newest first
    [...fotos].reverse().forEach(f => grid.appendChild(createPhotoCard(f)));
  }
}

/* ═══════════════════════════════════════
   9. MODALES
   ═══════════════════════════════════════ */
function openModal(modal) {
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add('active'));
  document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
  modal.classList.remove('active');
  setTimeout(() => { 
    modal.hidden = true; 
    document.body.style.overflow = '';
    
    // Stop video if viewer is closed
    const vidEl = document.getElementById('viewer-video');
    if (vidEl && !vidEl.hidden) {
      vidEl.pause();
      vidEl.src = '';
    }
  }, 300);
}

function setupModalClose(modalId, closeBtnId) {
  const modal = document.getElementById(modalId);
  if(!modal) return;
  const btn = document.getElementById(closeBtnId);
  btn.addEventListener('click', () => closeModal(modal));
  modal.querySelector('.modal-overlay').addEventListener('click', () => closeModal(modal));
}

/* ═══════════════════════════════════════
   10. INICIALIZACIÓN PRINCIPAL
   ═══════════════════════════════════════ */
(async function main() {
  PinSystem.init();
  AlbumDecorations.init();

  const db = new AlbumDB();

  try {
    await db.init();
  } catch (err) {
    showToast('Error al abrir la base de datos: ' + err.message, 'error');
    return;
  }

  // Modales setup
  setupModalClose('modal-add', 'modal-add-close');
  setupModalClose('modal-settings', 'modal-settings-close');
  setupModalClose('modal-viewer', 'modal-viewer-close');
  setupModalClose('modal-add-carta', 'modal-add-carta-close');

  // Cargar configuración
  let anniversary = null;
  try { anniversary = await db.getConfig('fechaAniversario'); } catch (_) {}

  if (anniversary) {
    Counter.start(anniversary);
    const dateInput = document.getElementById('anniversary-date');
    if(dateInput) dateInput.value = anniversary;
  }

  // Canvas
  SakuraCanvas.init();
  SakuraCanvas.startAnimation(); 

  // Cargar fotos y cartas
  try {
    const [fotos, cartas] = await Promise.all([
      db.getAllFotos(),
      db.getAllCartas()
    ]);
    renderGallery(fotos);
    renderCartas(cartas);
  } catch (err) {
    showToast('Error al cargar datos desde Supabase', 'error');
    console.error(err);
  }

  // Botón Configuración
  const btnSettings = document.getElementById('btn-settings');
  if(btnSettings) {
    btnSettings.addEventListener('click', () => {
      openModal(document.getElementById('modal-settings'));
    });
  }

  const btnSaveSettings = document.getElementById('btn-save-settings');
  if(btnSaveSettings) {
    btnSaveSettings.addEventListener('click', async () => {
      const val = document.getElementById('anniversary-date').value;
      if (!val) { showToast('Selecciona una fecha', 'error'); return; }
      try {
        await db.setConfig('fechaAniversario', val);
        Counter.start(val);
        SakuraCanvas.preRender();
        closeModal(document.getElementById('modal-settings'));
        showToast('Fecha guardada con éxito', 'success');
      } catch (err) {
        showToast('Error al guardar', 'error');
      }
    });
  }

  // ─── Botón Añadir Recuerdo ───
  let pendingFile = null;

  const btnAddMemory = document.getElementById('btn-add-memory');
  if(btnAddMemory) {
    btnAddMemory.addEventListener('click', () => {
      pendingFile = null;
      document.getElementById('photo-input').value = '';
      document.getElementById('photo-description').value = '';
      document.getElementById('photo-date').value = new Date().toISOString().split('T')[0];
      document.getElementById('char-current').textContent = '0';
      
      const imgPreview = document.getElementById('photo-preview-img');
      const vidPreview = document.getElementById('video-preview');
      imgPreview.hidden = true;
      vidPreview.hidden = true;
      vidPreview.pause();
      
      document.getElementById('photo-preview-container').classList.remove('has-image');
      document.getElementById('btn-save-photo').disabled = true;
      
      openModal(document.getElementById('modal-add'));
    });
  }

  // Input file handler
  const photoInput = document.getElementById('photo-input');
  if(photoInput) {
    document.getElementById('photo-preview-container').addEventListener('click', () => photoInput.click());
    
    photoInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await handleFileSelection(file);
      e.target.value = ''; // Clean input
    });
  }

  async function handleFileSelection(file) {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      showToast('Solo se permiten imágenes o videos', 'error');
      return;
    }
    
    // Máximo 20MB para asegurar subidas fluidas en Supabase
    if(file.size > 20 * 1024 * 1024) {
      showToast('El archivo es demasiado grande. Máximo 20MB', 'error');
      return;
    }

    try {
      showToast('Procesando archivo...', 'info');
      pendingFile = file; // Guardar archivo crudo
      
      const previewUrl = URL.createObjectURL(file);
      
      const imgPreview = document.getElementById('photo-preview-img');
      const vidPreview = document.getElementById('video-preview');
      
      if (file.type.startsWith('video/')) {
        imgPreview.hidden = true;
        vidPreview.hidden = false;
        vidPreview.src = previewUrl;
      } else {
        vidPreview.hidden = true;
        imgPreview.hidden = false;
        imgPreview.src = previewUrl;
      }
      
      document.getElementById('photo-preview-container').classList.add('has-image');
      document.getElementById('btn-save-photo').disabled = false;
      showToast('Archivo listo para guardar', 'success');
    } catch (err) {
      showToast('Error al procesar archivo', 'error');
    }
  }

  // Guardar foto
  const btnSavePhoto = document.getElementById('btn-save-photo');
  if(btnSavePhoto) {
    btnSavePhoto.addEventListener('click', async () => {
      if (!pendingFile) { showToast('Selecciona un archivo primero', 'error'); return; }
      
      const desc = document.getElementById('photo-description').value.trim();
      const fecha = document.getElementById('photo-date').value || new Date().toISOString().split('T')[0];

      try {
        btnSavePhoto.disabled = true;
        btnSavePhoto.textContent = 'Subiendo... ⏳';
        showToast('Subiendo archivo a la nube...', 'info');

        await db.addFoto({
          file: pendingFile,
          tipo: pendingFile.type,
          descripcion: Sanitizer.clean(desc),
          fecha: fecha
        });
        const fotos = await db.getAllFotos();
        renderGallery(fotos);
        closeModal(document.getElementById('modal-add'));
        showToast('Memoria guardada 🌻', 'success');
        pendingFile = null;
      } catch (err) {
        showToast('Error al guardar en la nube: ' + err.message, 'error');
      } finally {
        btnSavePhoto.disabled = false;
        btnSavePhoto.textContent = 'Guardar Recuerdo 💕';
      }
    });
  }

  // ─── Modal Añadir Carta ───
  const btnAddCarta = document.getElementById('btn-add-carta');
  const modalAddCarta = document.getElementById('modal-add-carta');
  if(btnAddCarta && modalAddCarta) {
    btnAddCarta.addEventListener('click', () => {
      document.getElementById('carta-text').value = '';
      document.getElementById('carta-firma').value = '';
      document.getElementById('carta-estilo').value = 'note-1';
      openModal(modalAddCarta);
    });
    
    document.getElementById('btn-save-carta').addEventListener('click', async () => {
      const texto = document.getElementById('carta-text').value.trim();
      const firma = document.getElementById('carta-firma').value.trim();
      const estilo = document.getElementById('carta-estilo').value;
      
      if (!texto || !firma) {
        showToast('Por favor escribe un mensaje y una firma', 'error');
        return;
      }
      
      const btnSave = document.getElementById('btn-save-carta');
      try {
        btnSave.disabled = true;
        btnSave.textContent = 'Guardando...';
        await db.addCarta({
          texto: Sanitizer.clean(texto),
          firma: Sanitizer.clean(firma),
          estilo: estilo
        });
        const cartas = await db.getAllCartas();
        renderCartas(cartas);
        closeModal(modalAddCarta);
        showToast('Carta guardada con amor 💌', 'success');
      } catch (err) {
        showToast('Error al guardar carta', 'error');
      } finally {
        btnSave.disabled = false;
        btnSave.textContent = 'Guardar Carta 💌';
      }
    });
  }

  // Eliminar foto
  const btnDeletePhoto = document.getElementById('btn-delete-photo');
  if(btnDeletePhoto) {
    btnDeletePhoto.addEventListener('click', async (e) => {
      const id = Number(e.target.dataset.id);
      if (!id || !confirm('¿Eliminar este recuerdo de forma permanente?')) return;
      try {
        await db.deleteFoto(id);
        const fotos = await db.getAllFotos();
        renderGallery(fotos);
        closeModal(document.getElementById('modal-viewer'));
        showToast('Recuerdo eliminado', 'info');
      } catch (err) {
        showToast('Error al eliminar', 'error');
      }
    });
  }

  // Contador caracteres
  const descInput = document.getElementById('photo-description');
  if(descInput) {
    descInput.addEventListener('input', (e) => {
      Sanitizer.setTextSafe(document.getElementById('char-current'), String(e.target.value.length));
    });
  }

  // Drag & Drop
  const dropZone = document.getElementById('drop-zone');
  const dzInput = document.getElementById('drop-zone-input');
  if(dropZone && dzInput) {
    ['dragenter', 'dragover'].forEach(ev => {
      dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    });
    ['dragleave', 'drop'].forEach(ev => {
      dropZone.addEventListener(ev, () => dropZone.classList.remove('drag-over'));
    });

    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
      if(files.length > 0) {
        document.getElementById('photo-input').value = '';
        document.getElementById('photo-description').value = '';
        document.getElementById('char-current').textContent = '0';
        await handleFileSelection(files[0]);
        openModal(document.getElementById('modal-add'));
      }
    });

    dzInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
      if(files.length > 0) {
        document.getElementById('photo-input').value = '';
        document.getElementById('photo-description').value = '';
        document.getElementById('char-current').textContent = '0';
        await handleFileSelection(files[0]);
        openModal(document.getElementById('modal-add'));
      }
      dzInput.value = '';
    });
  }

  // Abrir config en primera visita si no hay fecha y está desbloqueado
  if (!anniversary && PinSystem.isUnlocked) {
    setTimeout(() => openModal(document.getElementById('modal-settings')), 1000);
  }
})();
