# 🕯️ Vela de Cumpleaños Digital & Multijugador (BTL Experience)

Experiencia web interactiva en tiempo real (SPA) diseñada para activaciones BTL y eventos masivos, donde los asistentes pueden unirse desde sus teléfonos y apagar una vela gigante soplando al micrófono al mismo tiempo.

---

## 🚀 Tecnologías y Arquitectura

- **Frontend:** HTML5 semántico, CSS3 avanzado (animaciones de llama y resplandor multi-capa con `box-shadow`) y Vanilla JavaScript (ES Modules nativos).
- **Backend / Sincronización:** Firebase Realtime Database con transacciones atómicas (`runTransaction`) para evitar colisiones y condiciones de carrera con 50+ usuarios simultáneos.
- **Detección de Audio:** Web Audio API (`AudioContext`, `AnalyserNode`, cálculo de RMS en tiempo real y filtrado de ruido).
- **Despliegue:** Optimizado para **Vercel** o cualquier hosting estático (sin necesidad de pasos de compilación ni bundlers).

---

## 📁 Estructura del Proyecto

```text
├── index.html        # Estructura semántica, viewport móvil y modal de interacción
├── style.css         # Estética oscura, simulación de llama, glow y efectos
├── app.js            # Lógica de audio (RMS), transacciones Firebase y confeti
└── README.md         # Documentación de instalación y despliegue
```

---

## ⚙️ Configuración de Firebase

1. Ingresa a [Firebase Console](https://console.firebase.google.com/) y crea un nuevo proyecto.
2. Añade una **Aplicación Web** (`</>`) y copia el objeto `firebaseConfig`.
3. Habilita **Realtime Database** en la consola:
   - Ve a **Build** > **Realtime Database** > **Crear base de datos**.
   - En la pestaña **Rules (Reglas)**, para pruebas en vivo o eventos abiertos puedes configurar:
     ```json
     {
       "rules": {
         "vida_vela": {
           ".read": true,
           ".write": true
         }
       }
     }
     ```
4. Abre [app.js](file:///c:/Users/Camilo/Documents/antigravity/clever-kepler/app.js) y reemplaza los valores de `firebaseConfig` con tus credenciales:

```javascript
const firebaseConfig = {
  apiKey: "TU_API_KEY_AQUI",
  authDomain: "TU_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://TU_DATABASE_NAME.firebaseio.com",
  projectId: "TU_PROJECT_ID",
  storageBucket: "TU_PROJECT_ID.appspot.com",
  messagingSenderId: "TU_MESSAGING_SENDER_ID",
  appId: "TU_APP_ID"
};
```

> **Nota:** La aplicación cuenta con un **Modo Demo Local** automático. Si las credenciales aún no han sido insertadas, la app continuará funcionando localmente para que puedas calibrar la sensibilidad del soplido sin errores.

---

## 💻 Ejecución Local

Debido a las políticas de seguridad de los navegadores (Web Audio API y `navigator.mediaDevices.getUserMedia` requieren un contexto seguro `localhost` o `https://`):

```bash
# Con Node.js (npx serve)
npx serve .

# O con Python 3
python -m http.server 3000
```

Abre tu navegador en `http://localhost:3000`.

---

## 🚢 Despliegue en Vercel

1. Sube este repositorio a GitHub / GitLab.
2. Ve a [Vercel](https://vercel.com/) y selecciona **Add New Project**.
3. Importa el repositorio.
4. En **Framework Preset**, selecciona **Other** (sitio estático) y presiona **Deploy**.
5. ¡Listo! Vercel te proporcionará una URL con **HTTPS** (indispensable para que los móviles permitan el acceso al micrófono).
