# 🚀 IAmax Launcher - Android App (APK)

Aplicación nativa de Android para **IAmax Launcher** con motor WebView avanzado, inyector de sesiones (cookies) con `CookieManager`, escudos de protección (shields) y navegación integrada.

---

## 📱 ¿Cómo generar y descargar tu APK con GitHub Actions? (Método 1)

No necesitas instalar Android Studio en tu computadora. GitHub compilará el archivo `.apk` automáticamente en sus servidores en menos de 2 minutos.

### Paso 1: Crear un repositorio en GitHub
1. Entra a tu cuenta en [GitHub.com](https://github.com/) y haz clic en **New repository** (Nuevo repositorio).
2. Nómbralo (por ejemplo: `iamax-android-app`).
3. Puedes dejarlo **Público** o **Privado** (ambos funcionan con GitHub Actions).
4. **No** marques la opción de agregar README ni .gitignore (ya están creados). Haz clic en **Create repository**.

### Paso 2: Subir el código desde tu PC
Abre una terminal (PowerShell o CMD) en la carpeta del proyecto `c:\Users\grove\Downloads\IAmax-Android-App` y ejecuta estos comandos:

```bash
git init
git add .
git commit -m "feat: initial commit IAmax Android APK"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```
*(Reemplaza `TU_USUARIO/TU_REPOSITORIO` con el enlace de tu repositorio de GitHub)*.

### Paso 3: Descargar tu archivo `.apk`
1. En tu repositorio de GitHub en el navegador, ve a la pestaña superior **Actions**.
2. Verás el flujo **"Compilar APK Android"** ejecutándose (tarda ~1 a 2 minutos).
3. Cuando termine (aparecerá un círculo verde ✅), haz clic en él.
4. Al final de la página, en la sección **Artifacts**, haz clic en **`IAmax-Launcher-v1.3.8-APK`**.
5. Se descargará el archivo ZIP que contiene tu **`app-debug.apk`**.
6. Pásalo a tu celular o ábrelo directamente en el teléfono e instálalo.

---

## 🛠️ Estructura del Proyecto

* **`app/src/main/java/com/iamax/launcher/`**:
  * **`MainActivity.kt`**: Control del ciclo de vida, WebView y barra de navegación flotante.
  * **`bridge/IAmaxBridge.kt`**: Puente de comunicación nativa entre el Dashboard y Android (`@JavascriptInterface`).
  * **`engine/CookieInjector.kt`**: Inyector de cookies con `android.webkit.CookieManager` para inicio de sesión automático.
  * **`engine/ScriptInjector.kt`**: Inyector dinámico de escudos y scripts (`spoof.js`, `google_shield.js`, etc.).
  * **`storage/SessionStorage.kt`**: Persistencia de tokens y configuración en `SharedPreferences`.
* **`app/src/main/assets/`**:
  * **`chrome_shim.js`**: Capa de compatibilidad que emula las APIs de Chrome (`chrome.runtime`, `chrome.storage`, `chrome.tabs`).
  * **`dashboard/`**: Interfaz visual de perfiles y herramientas.
  * **`scripts/`**: Scripts de protección y escudos.
* **`.github/workflows/build-apk.yml`**: Automatización de compilación en la nube.
