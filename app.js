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

  async deleteCarta(id) {
    const { error } = await this.client.from('cartas').delete().eq('id', id);
    if (error) throw error;
  }

  // --- RESPUESTAS DIARIAS ---
  async getPreguntaDelDia(diaIndex) {
    const { data, error } = await this.client
      .from('preguntas')
      .select('pregunta')
      .eq('dia_index', diaIndex)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null; // No encontrada
      throw error;
    }
    return data.pregunta;
  }

  async addRespuestaDiaria(data) {
    const { error } = await this.client
      .from('respuestas_diarias')
      .insert([data]);
    if (error) throw error;
  }

  async getRespuestasDiarias(diaIndex) {
    const { data, error } = await this.client
      .from('respuestas_diarias')
      .select('*')
      .eq('dia_index', diaIndex)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return data || [];
  }

  // --- NOTIFICACIONES ---
  async addNotificacion(data) {
    const { error } = await this.client
      .from('notificaciones')
      .insert([data]);
    if (error) throw error;
  }

  async getNotificaciones() {
    const { data, error } = await this.client
      .from('notificaciones')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    
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
        
        // Re-renderizar el canvas ahora que app es visible y tiene dimensiones reales
        if (ConstellationCanvas.canvas) {
          ConstellationCanvas.resize();
          ConstellationCanvas.generateStars();
        }
        
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
   7. CONSTELACIÓN ESTELAR (CANVAS)
   ═══════════════════════════════════════ */
const ConstellationCanvas = {
  canvas: null, ctx: null, width: 0, height: 0,
  stars: [], animId: null, mouse: { x: -1000, y: -1000 },

  init() {
    this.canvas = document.getElementById('constellation-canvas');
    if(!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    
    this.resize();
    window.addEventListener('resize', () => { 
      this.resize(); 
      this.generateStars();
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.mouse.x = -1000; this.mouse.y = -1000;
    });
  },

  resize() {
    const w = this.canvas.parentElement.clientWidth - 10;
    // Un ratio de 3:2 o 16:9 hace un rectángulo armonioso. Usaremos 3:2.
    const h = w * (2 / 3);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.height = h + 'px';
    
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = w; this.height = h;
  },

  seededRandom(seed) {
    let s = seed;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  },

  generateStars() {
    const totalDays = Counter.getTotalDays();
    const caption = document.getElementById('constellation-caption');
    if (caption) {
      if (totalDays > 0) Sanitizer.setTextSafe(caption, `✨ ${totalDays} estrellas iluminan nuestro universo`);
      else Sanitizer.setTextSafe(caption, 'Configura la fecha para encender las estrellas');
    }

    this.stars = [];
    const count = Math.min(totalDays, 450); // Límite para no sobrecargar el navegador
    const rand = this.seededRandom(12345);

    for (let i = 0; i < count; i++) {
      let x, y;
      
      // 80% de las estrellas forman el corazón, 20% espolvoreadas al azar
      if (rand() > 0.2) {
        let inside = false;
        let attempts = 0;
        while(!inside && attempts < 50) {
          // Coordenadas matemáticas para el corazón: x entre -1.5 y 1.5, y entre -1.5 y 1.5
          const px = (rand() * 3) - 1.5;
          const py = (rand() * 3) - 1.5;
          
          // Ecuación del corazón: (x^2 + y^2 - 1)^3 - x^2 * y^3 <= 0
          const eq = Math.pow(px*px + py*py - 1, 3) - (px*px * Math.pow(py, 3));
          
          if (eq <= 0) { 
             // Escalar basándonos en la dimensión menor (altura) para no estirar el corazón
             const scale = Math.min(this.width, this.height) * 0.45;
             x = (this.width / 2) + (px * scale);
             y = (this.height / 2) - (py * scale) - (this.height * 0.05); // Centrar verticalmente
             inside = true;
          }
          attempts++;
        }
      } else {
        // Estrellas de fondo aleatorias
        x = rand() * this.width;
        y = rand() * this.height;
      }
      
      this.stars.push({
        x: x || rand() * this.width,
        y: y || rand() * this.height,
        size: rand() * 1.5 + 0.8,
        twinklePhase: rand() * Math.PI * 2,
        twinkleSpeed: rand() * 0.03 + 0.01
      });
    }
  },

  startAnimation() {
    this.generateStars();
    const ctx = this.ctx;
    
    const loop = () => {
      ctx.clearRect(0, 0, this.width, this.height);
      
      ctx.lineWidth = 0.6;
      for (let i = 0; i < this.stars.length; i++) {
        const s1 = this.stars[i];
        
        // Interacción con el cursor
        const dx = this.mouse.x - s1.x;
        const dy = this.mouse.y - s1.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 70) {
          ctx.beginPath();
          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(this.mouse.x, this.mouse.y);
          ctx.strokeStyle = `rgba(201,169,110,${1 - dist/70})`;
          ctx.stroke();
        }

        // Conectar estrellas cercanas
        for (let j = i + 1; j < this.stars.length; j++) {
          const s2 = this.stars[j];
          const ddx = s1.x - s2.x;
          const ddy = s1.y - s2.y;
          const d = ddx*ddx + ddy*ddy;
          if (d < 1200) {
            ctx.beginPath();
            ctx.moveTo(s1.x, s1.y);
            ctx.lineTo(s2.x, s2.y);
            ctx.strokeStyle = 'rgba(201,169,110,0.12)';
            ctx.stroke();
          }
        }
      }

      // Dibujar estrellas brillantes
      for (const s of this.stars) {
        s.twinklePhase += s.twinkleSpeed;
        const alpha = Math.abs(Math.sin(s.twinklePhase)) * 0.7 + 0.3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 230, 150, ${alpha})`;
        ctx.shadowBlur = s.size * 4;
        ctx.shadowColor = 'rgba(201,169,110,0.8)';
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      this.animId = requestAnimationFrame(loop);
    };
    if(this.animId) cancelAnimationFrame(this.animId);
    this.animId = requestAnimationFrame(loop);
  }
};

/* ═══════════════════════════════════════
   8. LUCIÉRNAGAS DORADAS
   ═══════════════════════════════════════ */
const Fireflies = {
  init() {
    const container = document.getElementById('fireflies');
    if (!container) return;
    for (let i = 0; i < 25; i++) {
      const fly = document.createElement('div');
      fly.className = 'firefly';
      fly.style.setProperty('--x', Math.random() * 100 + 'vw');
      fly.style.setProperty('--y', Math.random() * 100 + 'vh');
      fly.style.setProperty('--dur', 10 + Math.random() * 20 + 's');
      fly.style.setProperty('--delay', Math.random() * 15 + 's');
      fly.style.setProperty('--drift-x', (Math.random() - 0.5) * 300 + 'px');
      fly.style.setProperty('--drift-y', (Math.random() - 0.5) * 300 + 'px');
      fly.style.setProperty('--size', 2 + Math.random() * 4 + 'px');
      container.appendChild(fly);
    }
  }
};

/* ═══════════════════════════════════════
   9. SCROLL REVEAL
   ═══════════════════════════════════════ */
const ScrollReveal = {
  init() {
    const sections = document.querySelectorAll('#app > section');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    sections.forEach(s => {
      s.classList.add('reveal-section');
      observer.observe(s);
    });
  }
};

/* ═══════════════════════════════════════
   10. FRASES DE AMOR CON TYPEWRITER
   ═══════════════════════════════════════ */
const LoveQuotes = {
  quotes: [
    'En tu mirada encontré mi hogar',
    'Cada día contigo es mi día favorito',
    'Eres la razón de mis sonrisas más sinceras',
    'Contigo aprendí que el amor no se busca, se encuentra',
    'Mi corazón late al ritmo de tu nombre',
    'Eres mi persona favorita en todo el universo',
    'Gracias por elegirme todos los días',
    'Tu amor es el regalo más bonito de mi vida',
    'A tu lado todo es más brillante',
    'Eres mi calma en medio del caos',
    'Te amaré en esta vida y en todas las que vengan',
    'Contigo hasta el silencio es perfecto',
    'Eres el sueño del que no quiero despertar',
    'Cada momento contigo es un tesoro',
    'Mi lugar favorito es donde tú estás'
  ],
  currentIndex: 0,
  charIndex: 0,
  isDeleting: false,
  textEl: null,
  timeoutId: null,

  init() {
    this.textEl = document.getElementById('quote-text');
    if (!this.textEl) return;
    this.currentIndex = Math.floor(Math.random() * this.quotes.length);
    this.type();
  },

  type() {
    const current = this.quotes[this.currentIndex];
    if (!this.isDeleting) {
      this.charIndex++;
      this.textEl.textContent = current.substring(0, this.charIndex);
      if (this.charIndex === current.length) {
        this.timeoutId = setTimeout(() => { this.isDeleting = true; this.type(); }, 4000);
        return;
      }
      this.timeoutId = setTimeout(() => this.type(), 50 + Math.random() * 40);
    } else {
      this.charIndex--;
      this.textEl.textContent = current.substring(0, this.charIndex);
      if (this.charIndex === 0) {
        this.isDeleting = false;
        this.currentIndex = (this.currentIndex + 1) % this.quotes.length;
        this.timeoutId = setTimeout(() => this.type(), 500);
        return;
      }
      this.timeoutId = setTimeout(() => this.type(), 25);
    }
  }
};

/* ═══════════════════════════════════════
   11. PREGUNTA DEL DÍA
   ═══════════════════════════════════════ */
const DailyQuestion = {
  async init(db) {
    const textEl = document.getElementById('daily-question-text');
    const badgeEl = document.getElementById('question-day-badge');
    const container = document.getElementById('daily-question-interaction');
    if (!textEl || !container) return;

    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now - start) / 86400000);
    const diaIndex = (dayOfYear - 1 + 365) % 365;

    let preguntaTexto = '¿Qué es lo que más amas de nosotros?';
    try {
      const q = await db.getPreguntaDelDia(diaIndex);
      if (q) preguntaTexto = q;
    } catch(err) {
      console.warn("No se pudo cargar la pregunta de la base de datos.", err);
    }

    textEl.textContent = preguntaTexto;
    if (badgeEl) badgeEl.textContent = `Día ${diaIndex + 1}/365`;

    // Cargar respuestas de hoy
    let respuestas = [];
    try {
      respuestas = await db.getRespuestasDiarias(diaIndex);
    } catch(err) {
      console.warn("No se pudieron cargar respuestas (quizás falta la tabla).", err);
    }

    const miNombre = localStorage.getItem('mi_nombre_album') || '';
    const yoRespondi = respuestas.find(r => r.autor === miNombre && miNombre !== '');

    container.innerHTML = '';

    if (respuestas.length >= 2) {
      // ESTADO 3: Ambos respondieron
      const html = `
        <div class="dq-answers">
          ${respuestas.map(r => `
            <div class="dq-answer-box">
              <h4 class="dq-answer-author">${Sanitizer.clean(r.autor)} dijo:</h4>
              <p class="dq-answer-text">${Sanitizer.clean(r.respuesta)}</p>
            </div>
          `).join('')}
        </div>
      `;
      container.innerHTML = html;
    } 
    else if (yoRespondi) {
      // ESTADO 2: Yo respondí, esperando al otro
      const html = `
        <div class="dq-answers">
          <div class="dq-answer-box">
            <h4 class="dq-answer-author">Tu respuesta (${Sanitizer.clean(miNombre)}):</h4>
            <p class="dq-answer-text">${Sanitizer.clean(yoRespondi.respuesta)}</p>
          </div>
          <div class="dq-locked">
            <span class="dq-locked-icon">🔒</span>
            <p class="dq-locked-msg">Esperando la respuesta de tu pareja para revelar el secreto...</p>
          </div>
        </div>
      `;
      container.innerHTML = html;
    } 
    else {
      // ESTADO 1: Nadie o solo el otro ha respondido
      const form = document.createElement('div');
      form.className = 'dq-form';
      
      const isOtherWaiting = respuestas.length === 1;
      
      form.innerHTML = `
        ${isOtherWaiting ? `<p style="color:var(--gold-main);text-align:center;margin-bottom:1rem;font-family:var(--font-title);">✨ ¡Tu pareja ya respondió! Responde para revelar su secreto.</p>` : ''}
        <div class="dq-input-group">
          <label>¿Quién eres?</label>
          <input type="text" id="dq-autor" class="dq-input-name" placeholder="Tu nombre o apodo" value="${Sanitizer.clean(miNombre)}" maxlength="50">
        </div>
        <div class="dq-input-group">
          <label>Tu Respuesta</label>
          <textarea id="dq-respuesta" class="dq-input-answer" placeholder="Escribe desde el corazón..."></textarea>
        </div>
        <button id="btn-send-dq" class="btn-save">Enviar Respuesta 💕</button>
      `;
      
      container.appendChild(form);

      document.getElementById('btn-send-dq').addEventListener('click', async () => {
        const autor = document.getElementById('dq-autor').value.trim();
        const resp = document.getElementById('dq-respuesta').value.trim();
        if (!autor || !resp) {
          showToast('Por favor, completa ambos campos', 'error');
          return;
        }

        const btn = document.getElementById('btn-send-dq');
        try {
          btn.disabled = true;
          btn.textContent = 'Enviando...';
          localStorage.setItem('mi_nombre_album', autor);
          
          await db.addRespuestaDiaria({
            dia_index: diaIndex,
            autor: Sanitizer.clean(autor),
            respuesta: Sanitizer.clean(resp)
          });
          
          // Enviar notificación de que se respondió
          await db.addNotificacion({
            tipo: 'pregunta',
            mensaje: `${Sanitizer.clean(autor)} respondió a la Pregunta del Día 💭`
          });

          showToast('¡Respuesta guardada!', 'success');
          // Recargar sección
          this.init(db);
        } catch (err) {
          showToast('Error al guardar respuesta', 'error');
          btn.disabled = false;
          btn.textContent = 'Enviar Respuesta 💕';
        }
      });
    }
  }
};

/* ═══════════════════════════════════════
   12. SCROLL UI (Progress + Back to Top)
   ═══════════════════════════════════════ */
const ScrollUI = {
  init() {
    const progressBar = document.getElementById('scroll-progress');
    const btnTop = document.getElementById('btn-top');
    if (!progressBar && !btnTop) return;

    window.addEventListener('scroll', () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      if (progressBar) progressBar.style.width = pct + '%';
      if (btnTop) btnTop.hidden = scrollTop < 500;
    }, { passive: true });

    if (btnTop) {
      btnTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }
};

/* ═══════════════════════════════════════
   13. EASTER EGG
   ═══════════════════════════════════════ */
const EasterEgg = {
  clickCount: 0,
  timeout: null,

  init() {
    const title = document.querySelector('.album-title');
    if (!title) return;
    title.style.cursor = 'pointer';
    title.addEventListener('click', (e) => {
      e.stopPropagation();
      this.clickCount++;
      if (this.timeout) clearTimeout(this.timeout);
      this.timeout = setTimeout(() => this.clickCount = 0, 3000);
      if (this.clickCount >= 7) {
        this.clickCount = 0;
        this.trigger();
      }
    });
  },

  trigger() {
    const overlay = document.getElementById('easter-egg-overlay');
    if (!overlay) return;
    overlay.hidden = false;
    overlay.innerHTML = '';

    // Explosión de corazones
    const emojis = ['❤️', '💛', '🌻', '💕', '✨', '💝', '💖', '🌟'];
    for (let i = 0; i < 35; i++) {
      const heart = document.createElement('div');
      heart.className = 'easter-heart';
      heart.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      heart.style.setProperty('--tx', (Math.random() - 0.5) * window.innerWidth + 'px');
      heart.style.setProperty('--ty', (Math.random() - 0.5) * window.innerHeight + 'px');
      heart.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      heart.style.setProperty('--scale', 1 + Math.random() * 3);
      heart.style.setProperty('--delay', Math.random() * 0.5 + 's');
      overlay.appendChild(heart);
    }

    const msg = document.createElement('div');
    msg.className = 'easter-egg-message';
    msg.innerHTML = '<p class="easter-egg-text">Cada segundo contigo es un regalo que el universo me dio.<br>Eres mi todo. 💛🌻</p>';
    overlay.appendChild(msg);

    requestAnimationFrame(() => overlay.classList.add('active'));

    setTimeout(() => {
      overlay.classList.remove('active');
      setTimeout(() => { overlay.hidden = true; overlay.innerHTML = ''; }, 1500);
    }, 6000);
  }
};

/* ═══════════════════════════════════════
   14. GESTIÓN DE GALERÍA Y MEDIOS
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

  const btnDelete = document.createElement('button');
  btnDelete.className = 'btn-delete-carta';
  btnDelete.innerHTML = '🗑️';
  btnDelete.title = 'Eliminar carta';
  btnDelete.dataset.id = carta.id;

  article.appendChild(btnDelete);
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
   15. NOTIFICACIONES
   ═══════════════════════════════════════ */
const Notifications = {
  async init(db) {
    const btn = document.getElementById('btn-notifications');
    const badge = document.getElementById('notification-badge');
    const modal = document.getElementById('modal-notificaciones');
    const list = document.getElementById('notificaciones-list');
    if (!btn || !modal) return;

    setupModalClose('modal-notificaciones', 'modal-notificaciones-close');

    btn.addEventListener('click', () => {
      openModal(modal);
      badge.hidden = true;
      localStorage.setItem('last_read_notifications', Date.now().toString());
    });

    try {
      const notis = await db.getNotificaciones();
      this.render(notis, list);
      
      // Mostrar badge si hay algo nuevo
      if (notis.length > 0) {
        const lastRead = Number(localStorage.getItem('last_read_notifications')) || 0;
        const lastNotiTime = new Date(notis[0].created_at).getTime();
        if (lastNotiTime > lastRead) {
          badge.hidden = false;
        }
      }
    } catch(err) {
      console.warn("Error cargando notificaciones", err);
    }
  },

  render(notis, container) {
    if (notis.length === 0) {
      container.innerHTML = '<p class="notificaciones-empty">No hay novedades recientes.</p>';
      return;
    }

    const html = notis.map(n => {
      let icon = '🔔';
      if (n.tipo === 'foto') icon = '📸';
      if (n.tipo === 'carta') icon = '💌';
      if (n.tipo === 'pregunta') icon = '💭';

      let dateStr = '';
      try {
        const d = new Date(n.created_at);
        dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      } catch(_) {}

      return `
        <div class="notificacion-item">
          <span class="noti-icon">${icon}</span>
          <div class="noti-content">
            <p class="noti-msg">${Sanitizer.clean(n.mensaje)}</p>
            <span class="noti-date">${dateStr}</span>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = html;
  }
};

/* ═══════════════════════════════════════
   9. UX ENHANCEMENTS (POLVO, PRELOADER)
   ═══════════════════════════════════════ */
const UXEnhancements = {
  init() {
    this.initPreloader();
    this.initFairyDust();
  },

  initPreloader() {
    const preloader = document.getElementById('preloader');
    if(preloader) {
      window.addEventListener('load', () => {
        setTimeout(() => {
          preloader.classList.add('hidden');
          setTimeout(() => preloader.remove(), 1000);
        }, 1200); 
      });
      if(document.readyState === 'complete') {
        preloader.classList.add('hidden');
        setTimeout(() => preloader.remove(), 1000);
      }
    }
  },

  initFairyDust() {
    if (window.innerWidth < 768) return; 
    let lastTime = 0;
    window.addEventListener('mousemove', (e) => {
      const now = Date.now();
      if (now - lastTime < 50 && Math.random() > 0.3) return;
      lastTime = now;

      const dust = document.createElement('div');
      dust.className = 'fairy-dust';
      dust.style.left = (e.pageX - 2) + 'px';
      dust.style.top = (e.pageY - 2) + 'px';
      document.body.appendChild(dust);
      
      setTimeout(() => {
        if(dust.parentNode) dust.remove();
      }, 1000);
    });
  }
};

/* ═══════════════════════════════════════
   10. MODALES
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
  UXEnhancements.init();

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

  // Canvas de Constelación
  ConstellationCanvas.init();
  ConstellationCanvas.startAnimation();

  // Nuevos módulos
  Fireflies.init();
  LoveQuotes.init();
  DailyQuestion.init(db);
  ScrollUI.init();
  EasterEgg.init();
  Notifications.init(db);

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
        ConstellationCanvas.generateStars();
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
        showToast('Recuerdo guardado 💕', 'success');

        // Notificación silenciosa
        const miNombre = localStorage.getItem('mi_nombre_album') || 'Alguien';
        db.addNotificacion({
          tipo: 'foto',
          mensaje: `${miNombre} ha añadido un nuevo recuerdo al álbum 📸`
        }).catch(console.warn);
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
        showToast('Carta guardada 💌', 'success');
        
        // Notificación silenciosa
        db.addNotificacion({
          tipo: 'carta',
          mensaje: `${firma || 'Alguien'} ha escrito una nueva carta de amor 💌`
        }).catch(console.warn);
      } catch (err) {
        showToast('Error al guardar carta', 'error');
      } finally {
        btnSave.disabled = false;
        btnSave.textContent = 'Guardar Carta 💌';
      }
    });
  }

  // Eliminar carta (Delegación)
  const notesGrid = document.getElementById('notes-grid');
  if(notesGrid) {
    notesGrid.addEventListener('click', async (e) => {
      const btn = e.target.closest('.btn-delete-carta');
      if (!btn) return;
      
      const id = Number(btn.dataset.id);
      if (!id || !confirm('¿Eliminar esta carta de forma permanente?')) return;
      
      try {
        await db.deleteCarta(id);
        const cartas = await db.getAllCartas();
        renderCartas(cartas);
        showToast('Carta eliminada', 'info');
      } catch (err) {
        showToast('Error al eliminar', 'error');
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

  // Scroll reveal al final (después de que todo esté renderizado)
  setTimeout(() => ScrollReveal.init(), 100);
})();
