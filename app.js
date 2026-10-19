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
  apiKey: "TU_API_KEY_AQUI",
  authDomain: "TU_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://TU_DATABASE_NAME.firebaseio.com",
  projectId: "TU_PROJECT_ID",
  storageBucket: "TU_PROJECT_ID.appspot.com",
  messagingSenderId: "TU_MESSAGING_SENDER_ID",
  appId: "TU_APP_ID"
};

/* ==============================================================================
   2. CONSTANTES DEL SISTEMA Y CALIBRACIÓN
   ============================================================================== */
const CANDLE_CONFIG = {
  // Vida total inicial de la vela
  MAX_HEALTH: 10000,

  // Umbral RMS para considerar que el usuario está soplando.
  // Valores típicos: 0.05 a 0.12 (calibrado para micrófonos de móviles)
  BLOW_RMS_THRESHOLD: 0.075,

  // Daño infligido a la vela por cada tick de soplido detectado
  DAMAGE_PER_TICK: 45,

  // Intervalo de aceleración (throttle) para transacciones en Firebase (ms).
  // CRÍTICO PARA PRODUCCIÓN: Si 50 usuarios soplan a 60 FPS, enviaríamos
  // 3,000 transacciones/segundo a un solo nodo. Agrupar en batches de 120ms
  // garantiza fluidez total sin saturar la red ni saturar Firebase.
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

  // Batching de daño para Firebase
  pendingDamage: 0,
  lastTransactionTime: 0,
  transactionTimeout: null,

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
  victoryModal: document.getElementById("victory-modal"),
  btnRestartCelebration: document.getElementById("btn-restart-celebration"),
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
    DOM.connectionStatus.textContent = "● Modo Demo (Local)";
    DOM.connectionStatus.classList.add("warning");
    
    // Inicializar visualmente en modo local
    updateCandleVisuals(CANDLE_CONFIG.MAX_HEALTH);
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    const db = getDatabase(app);
    state.databaseRef = ref(db, CANDLE_CONFIG.DB_NODE);
    state.isFirebaseActive = true;

    DOM.connectionStatus.textContent = "● Sincronizado en Vivo";
    DOM.connectionStatus.classList.remove("warning");

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
      showToast("Error de conexión con Firebase Realtime Database");
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

  const damageToSend = state.pendingDamage;
  state.pendingDamage = 0;
  state.lastTransactionTime = Date.now();

  // Si estamos en Modo Demo (sin Firebase configurado aún)
  if (!state.isFirebaseActive || !state.databaseRef) {
    const simulatedHealth = Math.max(0, state.currentHealth - damageToSend);
    updateCandleVisuals(simulatedHealth);
    return;
  }

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
    if (!result.committed) {
      console.log("Transacción de soplido reintentada / abortada.");
    }
  }).catch((error) => {
    console.error("Error en runTransaction:", error);
  });
}

/**
 * Encola daño por soplido y ejecuta una transacción throttled.
 */
function recordBlowDamage(damageAmount) {
  if (state.isExtinguished) return;

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
 * Reinicia la vida de la vela a 10,000 HP.
 */
function resetCandleHealth() {
  if (state.isFirebaseActive && state.databaseRef) {
    set(state.databaseRef, CANDLE_CONFIG.MAX_HEALTH)
      .then(() => showToast("Vela encendida nuevamente a 10,000 HP"))
      .catch((err) => console.error("Error al reiniciar vela:", err));
  } else {
    updateCandleVisuals(CANDLE_CONFIG.MAX_HEALTH);
    showToast("Vela encendida en modo local");
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

  // Actualizar textos y barra de vida
  DOM.healthValueText.textContent = `${Math.round(percentage)}%`;
  DOM.healthRawText.textContent = `${state.currentHealth.toLocaleString()} / ${CANDLE_CONFIG.MAX_HEALTH.toLocaleString()} HP`;
  DOM.healthBarFill.style.width = `${percentage}%`;

  // Cambiar color de la barra según nivel de vida con colores de la marca
  if (percentage < 25) {
    DOM.healthBarFill.style.background = "linear-gradient(90deg, #ff3b30 0%, #e5a93b 100%)";
  } else {
    DOM.healthBarFill.style.background = "linear-gradient(90deg, #009ca6 0%, #00c2cb 40%, #e5ab35 80%, #ffd700 100%)";
  }

  // Variables CSS reactivas (Scale, Opacity y Glow Factor)
  // La llama se reduce proporcionalmente pero mantiene visibilidad hasta el final
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
    // Si la vela fue re-encendida
    if (state.isExtinguished) {
      state.isExtinguished = false;
      triggerRekindleState();
    }
  }
}

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

  // Retroalimentación háptica en teléfonos Android
  if (navigator.vibrate) {
    navigator.vibrate([100, 50, 100, 50, 200]);
  }

  // Mostrar modal de victoria "¡Deseo cumplido!" tras breve delay para impacto visual
  setTimeout(() => {
    DOM.victoryModal.classList.add("active");
    startConfettiCelebration();
  }, 450);
}

/**
 * Re-enciende la vela si se solicita un reinicio.
 */
function triggerRekindleState() {
  DOM.candleFlames.forEach(flame => flame.classList.remove("extinguished"));
  DOM.smokeContainers.forEach(smoke => smoke.classList.remove("active"));
  DOM.victoryModal.classList.remove("active");
  stopConfettiCelebration();
}

/* ==============================================================================
   7. CAPTURA DE AUDIO Y DETECCIÓN DE SOPLIDO (WEB AUDIO API)
   ============================================================================== */

/**
 * Inicia el AudioContext y solicita acceso al micrófono.
 * Debe ser invocado dentro de un evento de interacción del usuario (click/tap).
 */
async function startAudioCapture() {
  try {
    // Manejo de compatibilidad cruzada para AudioContext (iOS Safari & Chrome)
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      showToast("Tu navegador no soporta Web Audio API.");
      return;
    }

    state.audioContext = new AudioContextClass();

    // En iOS Safari, el AudioContext a menudo comienza en estado 'suspended'
    if (state.audioContext.state === "suspended") {
      await state.audioContext.resume();
    }

    // Configuración de restricciones de audio:
    // IMPORTANTE: echoCancellation y noiseSuppression en false evitan que el
    // procesador de audio del teléfono filtre el sonido del soplido como "ruido ambiente".
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
    } catch (e) {
      // Fallback estándar si el dispositivo no soporta restricciones avanzadas
      console.warn("Reintentando getUserMedia con restricciones estándar...");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    state.audioStream = stream;

    // Configurar grafo de audio
    const microphoneSource = state.audioContext.createMediaStreamSource(stream);
    
    // Crear AnalyserNode
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 512;
    state.analyser.smoothingTimeConstant = 0.2; // Respuesta ágil para soplidos

    // Conectar micrófono al Analyser (no conectar a destination para evitar feedback de audio)
    microphoneSource.connect(state.analyser);

    state.isListening = true;

    // Actualizar UI
    DOM.welcomeModal.classList.remove("active");
    DOM.micIndicator.classList.add("active");
    DOM.micText.textContent = "Micrófono conectado";
    showToast("¡Micrófono listo! Sopla para apagar la vela");

    // Iniciar bucle de análisis en tiempo real
    startAudioAnalysisLoop();

  } catch (error) {
    console.error("Error al acceder al micrófono:", error);
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      alert("Por favor permite el acceso al micrófono para interactuar con la vela.");
    } else {
      alert("No se pudo iniciar la captura de audio: " + error.message);
    }
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
        DOM.micIndicator.classList.add("blowing");
        DOM.micText.textContent = "💨 ¡Soplando!";
        DOM.blowFeedback.classList.add("active");
      }

      // Intensidad relativa del soplido para barra de feedback
      const intensity = Math.min(100, Math.round(((rms - CANDLE_CONFIG.BLOW_RMS_THRESHOLD) / 0.15) * 100));
      DOM.blowMeterFill.style.width = `${Math.max(15, intensity)}%`;

      // Calcular daño proporcional a la fuerza del soplido
      const dynamicDamage = Math.round(CANDLE_CONFIG.DAMAGE_PER_TICK * (1 + (rms * 2.5)));
      recordBlowDamage(dynamicDamage);

    } else {
      // Usuario no está soplando
      if (state.isUserBlowing) {
        state.isUserBlowing = false;
        DOM.candleFlames.forEach(flame => flame.classList.remove("is-blowing"));
        DOM.micIndicator.classList.remove("blowing");
        DOM.micText.textContent = "Listo para soplar";
        DOM.blowFeedback.classList.remove("active");
        DOM.blowMeterFill.style.width = "0%";
        
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

  const colors = ["#ffd700", "#ffbe0b", "#ff006e", "#8338ec", "#3a86ff", "#fb5607", "#ffffff"];
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
  DOM.toast.textContent = message;
  DOM.toast.classList.add("active");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    DOM.toast.classList.remove("active");
  }, 4500);
}

/* ==============================================================================
   10. LISTENERS DE EVENTOS Y REGISTRO DE USUARIO
   ============================================================================== */
function setupEventListeners() {
  // Botón inicial "Unirse a la celebración"
  DOM.btnJoin.addEventListener("click", () => {
    startAudioCapture();
  });

  // Botón reiniciar desde modal de victoria
  DOM.btnRestartCelebration.addEventListener("click", () => {
    resetCandleHealth();
  });

  // Botón reiniciar administrativo en footer (BTL Show Runner)
  DOM.btnReset.addEventListener("click", () => {
    if (confirm("¿Deseas reiniciar la vela a 10,000 HP para todos los usuarios?")) {
      resetCandleHealth();
    }
  });

  // Ajustar tamaño del canvas de confeti en caso de rotación de pantalla
  window.addEventListener("resize", () => {
    if (DOM.confettiCanvas) {
      DOM.confettiCanvas.width = window.innerWidth;
      DOM.confettiCanvas.height = window.innerHeight;
    }
  });
}

/* ==============================================================================
   ARRANQUE DE LA APLICACIÓN
   ============================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  initFirebase();
});
