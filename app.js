/**
 * ==============================================================================
 * VELA DE CUMPLEAÑOS DIGITAL & MULTIJUGADOR (BTL EXPERIENCE)
 * ==============================================================================
 * Stack: HTML5, CSS3, Vanilla JavaScript (ES Modules)
 * Sincronización: Firebase Realtime Database
 * Audio: Web Audio API (AnalyserNode + RMS Calculation)
 * ==============================================================================
 */

// Importaciones oficiales del SDK de Firebase v10 vía CDN (ES Modules)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  getDatabase, 
  ref, 
  onValue, 
  runTransaction, 
  set 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

/* ==============================================================================
   1. CONFIGURACIÓN DE FIREBASE REALTIME DATABASE
   ==============================================================================
   Inserta aquí las credenciales de tu proyecto de Firebase.
   Puedes obtenerlas en: Firebase Console -> Project Settings -> General -> Your apps
   ============================================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyClGXO8Xz08-qdUva_FZFKZk_Ig8tfAJgE",
  authDomain: "vela-compartida-01a14bed.firebaseapp.com",
  databaseURL: "https://vela-compartida-01a14bed-default-rtdb.firebaseio.com",
  projectId: "vela-compartida-01a14bed",
  storageBucket: "vela-compartida-01a14bed.firebasestorage.app",
  messagingSenderId: "899370760497",
  appId: "1:899370760497:web:8e5414005423f124c5d810"
};

/* ==============================================================================
   2. CONSTANTES DEL SISTEMA Y CALIBRACIÓN
   ============================================================================== */
const CANDLE_CONFIG = {
  // Vida total inicial de la vela
  MAX_HEALTH: 10000,

  // Umbral RMS para considerar que el usuario está soplando (calibrado para micrófonos de móviles)
  BLOW_RMS_THRESHOLD: 0.055,

  // Daño infligido a la vela por cada tick de soplido detectado (~2.5s a 3s de soplido continuo para apagarla solo, o ~1s en grupo)
  DAMAGE_PER_TICK: 60,

  // Intervalo de aceleración (throttle) para transacciones en Firebase (ms)
  TRANSACTION_THROTTLE_MS: 120,

  // Nombre del nodo en Firebase Realtime Database
  DB_NODE: "vida_vela"
};

/* ==============================================================================
   3. ESTADO GLOBAL DE LA APLICACIÓN
   ============================================================================== */
const state = {
  // Conexión
  isFirebaseActive: false,
  databaseRef: null,
  
  // Vida actual de la vela (0 a 10000)
  currentHealth: CANDLE_CONFIG.MAX_HEALTH,
  isExtinguished: false,

  // Audio & Soplido
  audioContext: null,
  analyser: null,
  audioStream: null,
  isListening: false,
  isUserBlowing: false,
  consecutiveBlowFrames: 0,

  // Batching de daño para Firebase y control de concurrencia
  pendingDamage: 0,
  lastTransactionTime: 0,
  transactionTimeout: null,
  isTransactionInProgress: false,

  // Sincronización de Animador / Showrunner BTL
  isEventLocked: false,
  lastHapticPulseTime: 0,
  isBigScreen: false,
  tapFlutterTimeout: null,

  // Animaciones auxiliares
  animationFrameId: null
};

/* ==============================================================================
   4. ELEMENTOS DEL DOM
   ============================================================================== */
const DOM = {
  welcomeModal: document.getElementById("welcome-modal"),
  btnJoin: document.getElementById("btn-join"),
  ambientGlow: document.getElementById("ambient-glow"),
  candleFlames: document.querySelectorAll(".candle-flame"),
  smokeContainers: document.querySelectorAll(".smoke-container"),
  healthBarFill: document.getElementById("health-bar-fill"),
  healthValueText: document.getElementById("health-value-text"),
  healthRawText: document.getElementById("health-raw-text"),
  micIndicator: document.getElementById("mic-indicator"),
  micText: document.getElementById("mic-text"),
  blowFeedback: document.getElementById("blow-feedback"),
  blowMeterFill: document.getElementById("blow-meter-fill"),
  cakeWrapper: document.getElementById("cake-wrapper"),
  waitingPill: document.getElementById("waiting-pill"),
  waitingText: document.getElementById("waiting-text"),
  victoryModal: document.getElementById("victory-modal"),
  victoryLogoTrigger: document.getElementById("victory-logo-trigger"),
  adminModal: document.getElementById("admin-modal"),
  btnAdminUnlock: document.getElementById("btn-admin-unlock"),
  btnAdminLock: document.getElementById("btn-admin-lock"),
  btnAdminReset: document.getElementById("btn-admin-reset"),
  btnAdminClose: document.getElementById("btn-admin-close"),
  btnReset: document.getElementById("btn-reset"),
  connectionStatus: document.getElementById("connection-status"),
  toast: document.getElementById("toast-notification"),
  confettiCanvas: document.getElementById("confetti-canvas")
};

/* ==============================================================================
   5. INICIALIZACIÓN DE FIREBASE & SINCRONIZACIÓN MULTIJUGADOR
   ============================================================================== */
function initFirebase() {
  const isPlaceholder = 
    !firebaseConfig.apiKey || 
    firebaseConfig.apiKey.includes("TU_API_KEY") ||
    firebaseConfig.databaseURL.includes("TU_DATABASE_NAME");

  if (isPlaceholder) {
    console.warn(
      "⚠️ Firebase: Credenciales no configuradas. La aplicación funcionará en MODO DEMO LOCAL.\n" +
      "Para habilitar el multijugador en vivo, reemplaza 'firebaseConfig' en app.js con tus credenciales de Firebase Console."
    );
    showToast("Modo Demo Local (Configura tus credenciales de Firebase en app.js)");
    if (DOM.connectionStatus) {
      DOM.connectionStatus.textContent = "● Modo Demo (Local)";
      DOM.connectionStatus.classList.add("warning");
    }
    
    // Inicializar visualmente en modo local
    updateCandleVisuals(CANDLE_CONFIG.MAX_HEALTH);
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    const db = getDatabase(app);
    state.databaseRef = ref(db, CANDLE_CONFIG.DB_NODE);
    state.isFirebaseActive = true;

    if (DOM.connectionStatus) {
      DOM.connectionStatus.textContent = "● Sincronizado en Vivo";
      DOM.connectionStatus.classList.remove("warning");
    }

    // Suscripción en tiempo real con onValue
    onValue(state.databaseRef, (snapshot) => {
      const val = snapshot.val();
      
      if (val === null || val === undefined) {
        // Si el nodo aún no existe en Firebase, inicializarlo con el valor máximo
        console.log(`Inicializando nodo '${CANDLE_CONFIG.DB_NODE}' con ${CANDLE_CONFIG.MAX_HEALTH}`);
        set(state.databaseRef, CANDLE_CONFIG.MAX_HEALTH);
        updateCandleVisuals(CANDLE_CONFIG.MAX_HEALTH);
      } else {
        // Actualizar la interfaz gráfica de todos los clientes conectados
        updateCandleVisuals(Number(val));
      }
    }, (error) => {
      console.error("Error al escuchar cambios en Firebase:", error);
      if (error.message && error.message.toLowerCase().includes("permission_denied")) {
        showToast("⚠️ Firebase: Falta habilitar las reglas de lectura/escritura en la consola");
        if (DOM.connectionStatus) {
          DOM.connectionStatus.textContent = "● Reglas bloqueadas en Firebase";
          DOM.connectionStatus.classList.add("warning");
        }
      } else {
        showToast("Error de conexión con Firebase Realtime Database");
      }
    });

    // Suscripción a la fase del evento (Momento del Deseo / Control del Animador)
    const stageRef = ref(db, "fase_evento");
    onValue(stageRef, (snapshot) => {
      const fase = snapshot.val();
      if (fase === "esperando") {
        state.isEventLocked = true;
        if (DOM.waitingPill) {
          DOM.waitingPill.classList.remove("blow-ready");
          DOM.waitingPill.classList.add("active");
          if (DOM.waitingText) DOM.waitingText.textContent = "Pide un deseo... esperando el conteo";
        }
      } else {
        // "activo" o null (por defecto habilitado)
        const wasLocked = state.isEventLocked;
        state.isEventLocked = false;
        if (wasLocked && DOM.waitingPill) {
          DOM.waitingPill.classList.add("blow-ready");
          if (DOM.waitingText) DOM.waitingText.textContent = "🎉 ¡A SOPLAR! ¡TODOS JUNTOS!";
          setTimeout(() => {
            if (!state.isEventLocked && DOM.waitingPill) {
              DOM.waitingPill.classList.remove("active");
              DOM.waitingPill.classList.remove("blow-ready");
            }
          }, 3200);
        } else if (DOM.waitingPill) {
          DOM.waitingPill.classList.remove("active");
        }
      }
    });

  } catch (error) {
    console.error("Error al inicializar Firebase:", error);
    showToast("Error al conectar Firebase. Revisa la consola.");
  }
}

/**
 * Aplica el daño acumulado a la base de datos usando runTransaction.
 * CRÍTICO: Garantiza concurrencia atómica cuando decenas de personas soplan simultáneamente.
 */
function flushPendingDamage() {
  if (state.pendingDamage <= 0) return;

  // Si ya hay una transacción en vuelo hacia Firebase, esperar a que termine para no colisionar
  if (state.isTransactionInProgress) {
    return;
  }

  const damageToSend = state.pendingDamage;
  state.pendingDamage = 0;
  state.lastTransactionTime = Date.now();

  // Si estamos en Modo Demo (sin Firebase configurado aún)
  if (!state.isFirebaseActive || !state.databaseRef) {
    const simulatedHealth = Math.max(0, state.currentHealth - damageToSend);
    updateCandleVisuals(simulatedHealth);
    return;
  }

  state.isTransactionInProgress = true;

  // Transacción atómica de Firebase
  runTransaction(state.databaseRef, (currentHealthInDb) => {
    // Si el valor no está definido, usar MAX_HEALTH
    if (currentHealthInDb === null || currentHealthInDb === undefined) {
      currentHealthInDb = CANDLE_CONFIG.MAX_HEALTH;
    }

    // Si ya está apagada, no restar más
    if (currentHealthInDb <= 0) {
      return 0;
    }

    // Resta atómica del daño acumulado
    return Math.max(0, currentHealthInDb - damageToSend);
  }).then((result) => {
    state.isTransactionInProgress = false;
    // Si se acumuló más daño mientras la petición estaba en vuelo, enviarlo inmediatamente
    if (state.pendingDamage > 0) {
      flushPendingDamage();
    }
  }).catch((error) => {
    state.isTransactionInProgress = false;
    console.error("Error en runTransaction:", error);
    if (state.pendingDamage > 0) {
      flushPendingDamage();
    }
  });
}

/**
 * Encola daño por soplido y ejecuta una transacción throttled.
 */
function recordBlowDamage(damageAmount) {
  if (state.isExtinguished) return;

  // Si el animador pausó los soplidos ("esperando"), no registrar daño
  if (state.isEventLocked) return;

  state.pendingDamage += damageAmount;

  const now = Date.now();
  const timeSinceLast = now - state.lastTransactionTime;

  if (timeSinceLast >= CANDLE_CONFIG.TRANSACTION_THROTTLE_MS) {
    flushPendingDamage();
  } else if (!state.transactionTimeout) {
    state.transactionTimeout = setTimeout(() => {
      state.transactionTimeout = null;
      flushPendingDamage();
    }, CANDLE_CONFIG.TRANSACTION_THROTTLE_MS - timeSinceLast);
  }
}

/**
 * Alternativa accesible de soplido mediante toques en pantalla (Tap-to-Blow).
 * Diseñado para entornos ruidosos o personas que prefieran interactuar tácticamente.
 */
function handleCakeTap(e) {
  if (state.isExtinguished) return;

  if (state.isEventLocked) {
    showToast("✨ Pide un deseo... esperando el conteo");
    return;
  }

  // Micro-vibración táctil (14ms)
  if (navigator.vibrate) navigator.vibrate(14);

  // Micro-flicker visual en las llamas al recibir el soplido táctil
  DOM.candleFlames.forEach(flame => flame.classList.add("is-blowing"));
  clearTimeout(state.tapFlutterTimeout);
  state.tapFlutterTimeout = setTimeout(() => {
    if (!state.isUserBlowing) {
      DOM.candleFlames.forEach(flame => flame.classList.remove("is-blowing"));
    }
  }, 130);

  // Daño táctil accesible (~120 HP por toque)
  recordBlowDamage(120);
}

/**
 * Cambia la fase del show en Firebase (Control de Animador / Showrunner).
 */
function setStageLock(isLocked) {
  state.isEventLocked = isLocked;
  const newPhase = isLocked ? "esperando" : "activo";
  if (state.isFirebaseActive) {
    const db = getDatabase();
    set(ref(db, "fase_evento"), newPhase)
      .then(() => showToast(isLocked ? "🟡 Soplidos pausados (Esperando conteo)" : "🟢 Soplidos habilitados (¡A soplar!)"))
      .catch((err) => console.error("Error al cambiar fase:", err));
  } else {
    showToast(isLocked ? "Modo Local: Pausado" : "Modo Local: Activo");
  }
}

/**
 * Sintetiza un acorde mágico festivo y un soplido cálido usando Web Audio API.
 * 0 archivos externos, 0 latencia, compatible con iOS y Android.
 */
function playCelebrationChime() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    const ctx = state.audioContext || new AudioContextClass();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // 1. Efecto soplido / pffft con filtro paso bajo suave
    const bufferSize = Math.floor(ctx.sampleRate * 0.35);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(750, now);
    filter.frequency.exponentialRampToValueAtTime(140, now + 0.35);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.22, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    whiteNoise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    whiteNoise.start(now);

    // 2. Acorde de campanas festivas (Mi Mayor Pentatónico: E5, G#5, B5, E6)
    const notes = [659.25, 830.61, 987.77, 1318.51];
    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + 0.15 + (index * 0.08));

      gain.gain.setValueAtTime(0, now);
      gain.gain.setValueAtTime(0.2, now + 0.15 + (index * 0.08));
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8 + (index * 0.1));

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + 0.15 + (index * 0.08));
      osc.stop(now + 2.2);
    });

  } catch (err) {
    console.warn("No se pudo reproducir audio de celebración:", err);
  }
}

/**
 * Reinicia la vida de la vela a 10,000 HP (para todos los asistentes).
 */
function resetCandleHealth() {
  updateCandleVisuals(CANDLE_CONFIG.MAX_HEALTH);
  if (state.isFirebaseActive && state.databaseRef) {
    set(state.databaseRef, CANDLE_CONFIG.MAX_HEALTH)
      .then(() => showToast("✨ Vela encendida a 10,000 HP"))
      .catch((err) => console.error("Error al reiniciar vela:", err));
  } else {
    showToast("✨ Vela encendida");
  }
}

/* ==============================================================================
   6. ACTUALIZACIÓN VISUAL DEL DOM (0% A 100%)
   ============================================================================== */
function updateCandleVisuals(health) {
  state.currentHealth = Math.max(0, health);
  
  // Porcentaje exacto de 0 a 100%
  const percentage = Math.max(0, Math.min(100, (state.currentHealth / CANDLE_CONFIG.MAX_HEALTH) * 100));
  const healthFraction = percentage / 100;

  // Actualizar textos y barra de vida si existen en el DOM
  if (DOM.healthValueText) DOM.healthValueText.textContent = `${Math.round(percentage)}%`;
  if (DOM.healthRawText) DOM.healthRawText.textContent = `${state.currentHealth.toLocaleString()} / ${CANDLE_CONFIG.MAX_HEALTH.toLocaleString()} HP`;
  if (DOM.healthBarFill) {
    DOM.healthBarFill.style.width = `${percentage}%`;
    if (percentage < 25) {
      DOM.healthBarFill.style.background = "linear-gradient(90deg, #ff3b30 0%, #e5a93b 100%)";
    } else {
      DOM.healthBarFill.style.background = "linear-gradient(90deg, #009ca6 0%, #00c2cb 40%, #e5ab35 80%, #ffd700 100%)";
    }
  }

  // Variables CSS reactivas (Scale, Opacity y Glow Factor)
  // La llama se reduce proporcionalmente y reacciona fluidamente
  const flameScale = healthFraction > 0 ? (0.45 + (0.55 * healthFraction)) : 0;
  const flameOpacity = healthFraction > 0 ? (0.35 + (0.65 * healthFraction)) : 0;
  const glowFactor = healthFraction;

  document.documentElement.style.setProperty("--flame-scale", flameScale.toFixed(3));
  document.documentElement.style.setProperty("--flame-opacity", flameOpacity.toFixed(3));
  document.documentElement.style.setProperty("--flame-glow-factor", glowFactor.toFixed(3));

  // ============================================================================
  // CONDICIÓN DE VELA APAGADA (VIDA <= 0)
  // ============================================================================
  if (state.currentHealth <= 0) {
    if (!state.isExtinguished) {
      state.isExtinguished = true;
      triggerExtinguishedState();
    }
  } else {
    // Si la vela fue re-encendida (ej. Easter Egg)
    if (state.isExtinguished) {
      state.isExtinguished = false;
      triggerRekindleState();
    }
  }
}

let autoCloseTimerId = null;

/**
 * Ejecuta la secuencia visual cuando la vela se apaga por completo.
 */
function triggerExtinguishedState() {
  // Apagar ambas llamas y sus glows
  DOM.candleFlames.forEach(flame => {
    flame.classList.add("extinguished");
    flame.classList.remove("is-blowing");
  });
  
  // Activar humo saliendo de ambas mechas
  DOM.smokeContainers.forEach(smoke => smoke.classList.add("active"));

  // Pausar escucha activa (mantenemos stream temporalmente por si activan el Easter Egg antes de 10s)
  state.isListening = false;

  // Reproducir sonido cálido de celebración y soplido vía Web Audio API
  playCelebrationChime();

  // Retroalimentación háptica en teléfonos móviles
  if (navigator.vibrate) {
    navigator.vibrate([100, 60, 150, 60, 300]);
  }

  // Mostrar modal de agradecimiento institucional tras breve delay
  setTimeout(() => {
    if (DOM.victoryModal) DOM.victoryModal.classList.add("active");
    startConfettiCelebration();
    // En modo pantalla gigante / proyector no cerrar automáticamente
    if (!state.isBigScreen) {
      startAutoCloseCountdown(10);
    }
  }, 450);
}

/**
 * Inicia la cuenta en segundo plano de 10 segundos y cierra automáticamente la página.
 */
function startAutoCloseCountdown(totalSeconds = 10) {
  if (autoCloseTimerId) {
    clearTimeout(autoCloseTimerId);
    autoCloseTimerId = null;
  }

  autoCloseTimerId = setTimeout(() => {
    autoCloseTimerId = null;

    // Liberar micrófono
    if (state.audioStream) {
      state.audioStream.getTracks().forEach(track => track.stop());
      state.audioStream = null;
    }
    state.isListening = false;

    // Intentar cerrar automáticamente la ventana
    try {
      window.open('', '_self', '');
      window.close();
    } catch (err) {
      console.log("window.close() no permitido por la política del navegador:", err);
    }
  }, totalSeconds * 1000);
}

/**
 * Re-enciende la vela si se activa el Easter Egg o se solicita un reinicio.
 */
function triggerRekindleState() {
  if (autoCloseTimerId) {
    clearTimeout(autoCloseTimerId);
    autoCloseTimerId = null;
  }
  DOM.candleFlames.forEach(flame => {
    flame.classList.remove("extinguished");
    flame.classList.remove("is-blowing");
  });
  DOM.smokeContainers.forEach(smoke => smoke.classList.remove("active"));
  if (DOM.victoryModal) DOM.victoryModal.classList.remove("active");
  stopConfettiCelebration();

  // Reanudar detección de soplido si el micrófono ya estaba listo
  if (state.audioContext && state.analyser && state.audioStream) {
    state.isListening = true;
    startAudioAnalysisLoop();
  }
}

/* ==============================================================================
   7. CAPTURA DE AUDIO Y DETECCIÓN DE SOPLIDO (WEB AUDIO API)
   ============================================================================== */

let isInitializingAudio = false;

/**
 * Inicia el AudioContext y solicita acceso al micrófono.
 * Debe ser invocado dentro de un evento de interacción del usuario (click/tap).
 */
async function startAudioCapture() {
  if (isInitializingAudio || state.isListening) {
    if (DOM.welcomeModal) DOM.welcomeModal.classList.remove("active");
    return;
  }
  isInitializingAudio = true;

  // Actualizar feedback visual instantáneo en el botón
  if (DOM.btnJoin) {
    const btnContent = DOM.btnJoin.querySelector(".btn-content");
    if (btnContent) btnContent.textContent = "CONECTANDO...";
  }

  // 1. Inicializar AudioContext sincrónicamente dentro del gesto del usuario (crítico para iOS Safari)
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass) {
    try {
      state.audioContext = new AudioContextClass();
      if (state.audioContext.state === "suspended") {
        state.audioContext.resume();
      }

      // Desbloqueo nativo del motor de audio de iOS Safari (reproduce micro-buffer silencioso en el tap)
      try {
        const silentBuffer = state.audioContext.createBuffer(1, 1, 22050);
        const source = state.audioContext.createBufferSource();
        source.buffer = silentBuffer;
        source.connect(state.audioContext.destination);
        source.start(0);
      } catch (unlockErr) {
        // Ignorable si el navegador no lo requiere
      }
    } catch (e) {
      console.warn("AudioContext init warning:", e);
    }
  }

  // 2. Verificar si el navegador soporta getUserMedia
  const hasMediaDevices = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  if (!hasMediaDevices) {
    console.warn("getUserMedia no soportado o contexto no seguro (se requiere HTTPS o localhost).");
    showToast("Modo espectador: Visualizando la celebración en vivo.");
    if (DOM.micText) DOM.micText.textContent = "Modo espectador";
    if (DOM.welcomeModal) DOM.welcomeModal.classList.remove("active");
    isInitializingAudio = false;
    return;
  }

  // 3. Solicitar permiso de micrófono al navegador
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioStream = stream;

    // Conectar analizador de audio si tenemos AudioContext
    if (state.audioContext) {
      // iOS Safari suspende AudioContext mientras el diálogo nativo está en pantalla; reanudarlo aquí
      if (state.audioContext.state === "suspended") {
        await state.audioContext.resume();
      }
      const microphoneSource = state.audioContext.createMediaStreamSource(stream);
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 512;
      state.analyser.smoothingTimeConstant = 0.2;

      microphoneSource.connect(state.analyser);
      state.isListening = true;

      // Actualizar UI del indicador
      if (DOM.micIndicator) DOM.micIndicator.classList.add("active");
      if (DOM.micText) DOM.micText.textContent = "Micrófono conectado";
      showToast("¡Micrófono listo! Sopla para apagar la vela");

      // Iniciar bucle de análisis en tiempo real
      startAudioAnalysisLoop();
    }
  } catch (error) {
    console.error("Acceso al micrófono no disponible o denegado:", error);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isInApp = /FBAN|FBAV|Instagram|WhatsApp|Line|Twitter|Snapchat/i.test(navigator.userAgent);

    if (isInApp && isIOS) {
      showToast("💡 En iPhone: Si no puedes soplar, abre en Safari tocando 'Compartir' o '...'");
    } else if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      showToast("Permiso de micrófono no concedido. Modo espectador activo.");
    } else {
      showToast("Modo espectador: Visualizando la celebración en vivo.");
    }
    if (DOM.micText) DOM.micText.textContent = "Modo espectador";
  } finally {
    // Al resolver o rechazar el permiso, ocultar el modal de bienvenida
    if (DOM.welcomeModal) {
      DOM.welcomeModal.classList.remove("active");
    }
    isInitializingAudio = false;
  }
}

/**
 * Calcula el volumen promedio (RMS - Root Mean Square) a partir del dominio del tiempo.
 * RMS = sqrt( sum(sample^2) / N )
 */
function computeRMS(analyser, timeBuffer) {
  if (analyser.getFloatTimeDomainData) {
    analyser.getFloatTimeDomainData(timeBuffer);
    let sumSquares = 0;
    for (let i = 0; i < timeBuffer.length; i++) {
      const val = timeBuffer[i];
      sumSquares += val * val;
    }
    return Math.sqrt(sumSquares / timeBuffer.length);
  } else {
    // Fallback con Uint8Array para navegadores más antiguos
    const byteBuffer = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(byteBuffer);
    let sumSquares = 0;
    for (let i = 0; i < byteBuffer.length; i++) {
      const normalized = (byteBuffer[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    return Math.sqrt(sumSquares / byteBuffer.length);
  }
}

/**
 * Bucle en tiempo real (requestAnimationFrame) para detectar el soplido.
 */
function startAudioAnalysisLoop() {
  const timeBuffer = new Float32Array(state.analyser.fftSize);

  function analyzeFrame() {
    if (!state.isListening) return;

    // Calcular RMS actual
    const rms = computeRMS(state.analyser, timeBuffer);

    // Detección de soplido: el RMS debe superar el umbral calibrado
    const isOverThreshold = rms >= CANDLE_CONFIG.BLOW_RMS_THRESHOLD;

    if (isOverThreshold && !state.isExtinguished) {
      state.consecutiveBlowFrames++;
    } else {
      state.consecutiveBlowFrames = Math.max(0, state.consecutiveBlowFrames - 2);
    }

    // Se considera soplido activo si supera el umbral de manera consistente (2+ frames)
    const isBlowingNow = state.consecutiveBlowFrames >= 2 && !state.isExtinguished;

    if (isBlowingNow) {
      // Estado de soplido activo
      if (!state.isUserBlowing) {
        state.isUserBlowing = true;
        DOM.candleFlames.forEach(flame => flame.classList.add("is-blowing"));
        if (DOM.micIndicator) DOM.micIndicator.classList.add("blowing");
        if (DOM.micText) DOM.micText.textContent = "💨 ¡Soplando!";
        if (DOM.blowFeedback) DOM.blowFeedback.classList.add("active");
      }

      // Intensidad relativa del soplido para barra de feedback si existe
      if (DOM.blowMeterFill) {
        const intensity = Math.min(100, Math.round(((rms - CANDLE_CONFIG.BLOW_RMS_THRESHOLD) / 0.15) * 100));
        DOM.blowMeterFill.style.width = `${Math.max(15, intensity)}%`;
      }

      // Feedback háptico progresivo mientras sopla (cada 180ms)
      const now = Date.now();
      if (now - state.lastHapticPulseTime > 180) {
        state.lastHapticPulseTime = now;
        if (navigator.vibrate) navigator.vibrate(22);
      }

      // Calcular daño proporcional a la fuerza del soplido
      const dynamicDamage = Math.round(CANDLE_CONFIG.DAMAGE_PER_TICK * (1 + (rms * 2.5)));
      recordBlowDamage(dynamicDamage);

    } else {
      // Usuario no está soplando
      if (state.isUserBlowing) {
        state.isUserBlowing = false;
        DOM.candleFlames.forEach(flame => flame.classList.remove("is-blowing"));
        if (DOM.micIndicator) DOM.micIndicator.classList.remove("blowing");
        if (DOM.micText) DOM.micText.textContent = "Listo para soplar";
        if (DOM.blowFeedback) DOM.blowFeedback.classList.remove("active");
        if (DOM.blowMeterFill) DOM.blowMeterFill.style.width = "0%";
        
        // Vaciar cualquier daño residual acumulado
        flushPendingDamage();
      }
    }

    state.animationFrameId = requestAnimationFrame(analyzeFrame);
  }

  analyzeFrame();
}

/* ==============================================================================
   8. SISTEMA DE CONFETI DE CELEBRACIÓN (Canvas 2D Autónomo)
   ============================================================================== */
let confettiParticles = [];
let confettiAnimationFrame = null;

function startConfettiCelebration() {
  const canvas = DOM.confettiCanvas;
  const ctx = canvas.getContext("2d");
  
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ["#009ca6", "#00c2cb", "#d49b28", "#f5c042", "#004b54", "#ffffff"];
  confettiParticles = [];

  for (let i = 0; i < 110; i++) {
    confettiParticles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      speedY: Math.random() * 3 + 2,
      speedX: (Math.random() - 0.5) * 2.5,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 6
    });
  }

  function renderConfetti() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    confettiParticles.forEach((p) => {
      p.y += p.speedY;
      p.x += p.speedX;
      p.rotation += p.rotationSpeed;

      if (p.y > canvas.height) {
        p.y = -10;
        p.x = Math.random() * canvas.width;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });

    confettiAnimationFrame = requestAnimationFrame(renderConfetti);
  }

  renderConfetti();
}

function stopConfettiCelebration() {
  if (confettiAnimationFrame) {
    cancelAnimationFrame(confettiAnimationFrame);
    confettiAnimationFrame = null;
  }
  const ctx = DOM.confettiCanvas.getContext("2d");
  ctx.clearRect(0, 0, DOM.confettiCanvas.width, DOM.confettiCanvas.height);
}

/* ==============================================================================
   9. NOTIFICACIONES TOAST AUXILIARES
   ============================================================================== */
let toastTimeout;
function showToast(message) {
  if (!DOM.toast) return;
  DOM.toast.textContent = message;
  DOM.toast.classList.add("active");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    if (DOM.toast) DOM.toast.classList.remove("active");
  }, 4500);
}

/* ==============================================================================
   10. LISTENERS DE EVENTOS Y REGISTRO DE USUARIO
   ============================================================================== */
function setupEventListeners() {
  // Botón inicial "Unirse a la celebración"
  if (DOM.btnJoin) {
    DOM.btnJoin.addEventListener("click", (e) => {
      e.preventDefault();
      startAudioCapture();
    });
  }

  // Respaldo Táctil: Tocar o cliquear la torta para soplar (accesibilidad y entornos ruidosos)
  if (DOM.cakeWrapper) {
    DOM.cakeWrapper.addEventListener("click", (e) => {
      handleCakeTap(e);
    });
  }

  // Controles del Panel de Administración (Staff / Animador)
  if (DOM.btnAdminUnlock) {
    DOM.btnAdminUnlock.addEventListener("click", () => setStageLock(false));
  }
  if (DOM.btnAdminLock) {
    DOM.btnAdminLock.addEventListener("click", () => setStageLock(true));
  }
  if (DOM.btnAdminReset) {
    DOM.btnAdminReset.addEventListener("click", () => {
      if (confirm("¿Reiniciar la vela a 10,000 HP para todos los participantes?")) {
        resetCandleHealth();
      }
    });
  }
  if (DOM.btnAdminClose) {
    DOM.btnAdminClose.addEventListener("click", () => {
      if (DOM.adminModal) DOM.adminModal.classList.remove("active");
    });
  }

  // Triple toque en el logo de bienvenida o victoria para abrir el Panel de Staff
  let logoTapCount = 0;
  let logoTapTimer = null;
  document.querySelectorAll(".brand-logo-img").forEach((logo) => {
    logo.addEventListener("click", () => {
      logoTapCount++;
      clearTimeout(logoTapTimer);
      if (logoTapCount >= 3) {
        logoTapCount = 0;
        if (DOM.adminModal) DOM.adminModal.classList.add("active");
        if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
      } else {
        logoTapTimer = setTimeout(() => {
          logoTapCount = 0;
        }, 500);
      }
    });
  });

  // Atajos de teclado para operadores de pantalla gigante / proyector
  window.addEventListener("keydown", (e) => {
    // Tecla 'A': Abrir / cerrar Panel de Control
    if (e.key === "a" || e.key === "A") {
      if (DOM.adminModal) DOM.adminModal.classList.toggle("active");
    }
    // Tecla 'R': Reiniciar vela a 10,000 HP
    if (e.key === "r" || e.key === "R") {
      resetCandleHealth();
    }
    // Tecla 'B' o Espacio: Alternar fase (Pausar / Habilitar soplidos)
    if (e.key === "b" || e.key === "B" || e.code === "Space") {
      // Evitar scroll de la página si se pulsa espacio
      e.preventDefault();
      setStageLock(!state.isEventLocked);
    }
    // Tecla 'F': Alternar Pantalla Completa
    if (e.key === "f" || e.key === "F") {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  });

  // Easter Egg en pantalla final: Tocar el logo de Hogar de Cristo antes de los 10s reinicia la experiencia
  const victoryLogo = DOM.victoryLogoTrigger || document.getElementById("victory-logo-trigger");
  if (victoryLogo) {
    victoryLogo.addEventListener("click", (e) => {
      e.preventDefault();
      // Solo actuar si el modal final está activo
      if (DOM.victoryModal && DOM.victoryModal.classList.contains("active")) {
        console.log("✨ Easter Egg activado: Reiniciando experiencia colaborativa...");
        if (navigator.vibrate) navigator.vibrate([60, 40, 80]);
        showToast("✨ ¡Celebración reiniciada!");

        // Cancelar el auto-cierre de 10s
        if (autoCloseTimerId) {
          clearTimeout(autoCloseTimerId);
          autoCloseTimerId = null;
        }

        // Reiniciar vela en Firebase a 10,000 HP (para todos los asistentes)
        resetCandleHealth();

        // Re-encender localmente de inmediato
        triggerRekindleState();
      }
    });
  }

  // Botón reiniciar administrativo en footer (BTL Show Runner) si existe
  if (DOM.btnReset) {
    DOM.btnReset.addEventListener("click", () => {
      if (confirm("¿Deseas reiniciar la vela a 10,000 HP para todos los usuarios?")) {
        resetCandleHealth();
      }
    });
  }

  // Ajustar tamaño del canvas de confeti en caso de rotación de pantalla
  window.addEventListener("resize", () => {
    if (DOM.confettiCanvas) {
      DOM.confettiCanvas.width = window.innerWidth;
      DOM.confettiCanvas.height = window.innerHeight;
    }
  });

  // Blindaje iOS / WebKit: Reanudar AudioContext si el usuario cambia de app o baja el Centro de Control
  const resumeAudioOnReturn = () => {
    if (state.audioContext && state.audioContext.state === "suspended" && state.isListening) {
      state.audioContext.resume().catch((e) => console.log("AudioContext auto-resume:", e));
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      resumeAudioOnReturn();
    }
  });
  window.addEventListener("pageshow", resumeAudioOnReturn);
}

/* ==============================================================================
   ARRANQUE DE LA APLICACIÓN (Garantiza ejecución sin importar el ciclo de vida)
   ============================================================================== */
function startApp() {
  try {
    setupEventListeners();
    initFirebase();

    const urlParams = new URLSearchParams(window.location.search);

    // 1. Modo Pantalla Gigante / Proyector (?pantalla=1 / ?stage=1 / ?proyector=1)
    if (urlParams.has("pantalla") || urlParams.has("proyector") || urlParams.has("stage") || urlParams.has("screen")) {
      state.isBigScreen = true;
      document.body.classList.add("big-screen-mode");
      // Ocultar modal de bienvenida directamente en pantalla gigante
      if (DOM.welcomeModal) {
        DOM.welcomeModal.classList.remove("active");
      }
      console.log("🖥️ Modo Pantalla Gigante activado para proyector BTL");
    }

    // 2. Acceso directo al Panel de Control de Staff (?admin=1 / ?control=1)
    if (urlParams.has("admin") || urlParams.has("staff") || urlParams.has("control")) {
      if (DOM.adminModal) {
        DOM.adminModal.classList.add("active");
      }
    }

    // 3. Reinicio rápido por parámetro URL (?reset=1)
    if (urlParams.has("reset") || urlParams.has("reiniciar")) {
      setTimeout(() => resetCandleHealth(), 400);
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (e) {}
    }
  } catch (err) {
    console.error("Error al arrancar la aplicación:", err);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp);
} else {
  startApp();
}
