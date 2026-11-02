#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# 📱 build.sh - Local Build Script for Expo/React Native (APK/AAB)
# Generado por MetaBuilder Orchestrator — genérico para apps Expo.
# Uso: bash build.sh [test|staging|production] [--format apk|aab] [--no-install]
# ═══════════════════════════════════════════════════════════════

# ───────────────────────────────────────────────────────────────
# ⚙️ CONFIGURACIÓN Y VARIABLES
# ───────────────────────────────────────────────────────────────

# Valores por defecto
ENVIRONMENT="${1:-test}"
FORMAT="apk"
NO_INSTALL=false
KEYS_DIR="keys"
GRADLE_PROPS="android/gradle.properties"
APK_OUT="android/app/build/outputs/apk"
AAB_OUT="android/app/build/outputs/bundle"

# APP_ID dinámico desde app.json (sobrevive cambios de package name)
APP_ID=$(node -p "require('./app.json').expo?.android?.package ?? ''" 2>/dev/null || echo "")

# Parsear argumentos con flags
shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --format)
      FORMAT="${2,,}"
      shift 2
      ;;
    --no-install)
      NO_INSTALL=true
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# Validaciones iniciales
if [[ ! "$ENVIRONMENT" =~ ^(test|staging|production)$ ]]; then
  echo -e "\e[31m❌ Entorno inválido. Usa: test | staging | production\e[0m"
  exit 1
fi

if [[ ! "$FORMAT" =~ ^(apk|aab)$ ]]; then
  echo -e "\e[31m❌ Formato inválido. Usa: apk | aab\e[0m"
  exit 1
fi

# Test solo soporta APK
if [[ "$ENVIRONMENT" == "test" && "$FORMAT" == "aab" ]]; then
  echo -e "\e[33m⚠️  Test build solo soporta APK. Forzando formato apk.\e[0m"
  FORMAT="apk"
fi

# ───────────────────────────────────────────────────────────────
# 🎨 HELPERS DE UI Y LOGGING
# ───────────────────────────────────────────────────────────────

RED='\e[31m' GREEN='\e[32m' YELLOW='\e[33m' BLUE='\e[34m' CYAN='\e[36m' NC='\e[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[⚠]${NC} $1"; }
log_error()   { echo -e "${RED}[✗]${NC} $1"; }
log_step()    { echo -e "\n${CYAN}➜${NC} ${BLUE}$1${NC}"; }

show_credentials() {
  local env="$1" keystore="$2" alias="$3" store_pass="$4" key_pass="$5"
  local keystore_dir="$KEYS_DIR/$env"
  local creds_file="$keystore_dir/credentials.json"

  # Guardar credenciales en formato JSON
  mkdir -p "$keystore_dir"
  cat > "$creds_file" << EOF
{
  "environment": "$env",
  "keystore": "$keystore",
  "alias": "$alias",
  "storePassword": "$store_pass",
  "keyPassword": "$key_pass"
}
EOF

  echo -e "\n${RED}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║${NC}  ⚠️  ¡GUARDA ESTAS CREDENCIALES AHORA! ⚠️       ${RED}║${NC}"
  echo -e "${RED}║${NC}  Sin ellas NO podrás actualizar la app en Play   ${RED}║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════════════╝${NC}\n"
  echo -e "${YELLOW}📦 Entorno:${NC}   $env"
  echo -e "${YELLOW}📦 Keystore:${NC}  $keystore"
  echo -e "${YELLOW}🔑 Alias:${NC}     $alias"
  echo -e "${YELLOW}🔐 Store Pass:${NC} $store_pass"
  echo -e "${YELLOW}🔐 Key Pass:${NC}   $key_pass\n"
  echo -e "${GREEN}💡 Credenciales guardadas automáticamente en: $creds_file${NC}"
  echo -e "${GREEN}💡 Copia y guarda estas credenciales en un gestor seguro.${NC}"
  echo -e "${YELLOW}📝 Tip: También están en $GRADLE_PROPS (gitignored con keys/)${NC}"
  # En modo no-interactivo (CI/orquestador) no bloquear con read -p
  if [[ -t 0 ]]; then
    read -p "Presiona ENTER después de guardar las credenciales..."
  else
    log_warn "Modo no-interactivo: credenciales en $creds_file"
  fi
}

# ───────────────────────────────────────────────────────────────
# 🔍 VERIFICACIÓN DE PRERREQUISITOS
# ───────────────────────────────────────────────────────────────

check_prerequisites() {
  log_step "Verificando prerequisitos..."
  local missing=()

  # Verificar que ANDROID_HOME o ANDROID_SDK_ROOT esté configurado PRIMERO
  if [[ -z "$ANDROID_HOME" && -z "$ANDROID_SDK_ROOT" ]]; then
    log_warn "ANDROID_HOME no está configurado. Intentando detectar..."
    if [[ -d "$HOME/Library/Android/sdk" ]]; then
      export ANDROID_HOME="$HOME/Library/Android/sdk"
    elif [[ -d "$HOME/Android/Sdk" ]]; then
      export ANDROID_HOME="$HOME/Android/Sdk"
    elif [[ -d "/usr/local/Android/sdk" ]]; then
      export ANDROID_HOME="/usr/local/Android/sdk"
    else
      log_error "No se pudo detectar Android SDK. Configura ANDROID_HOME"
      exit 1
    fi
    log_info "ANDROID_HOME detectado: $ANDROID_HOME"
  fi

  # Agregar platform-tools al PATH si adb no está disponible directamente
  if ! command -v adb >/dev/null 2>&1 && [[ -n "$ANDROID_HOME" && -f "$ANDROID_HOME/platform-tools/adb" ]]; then
    export PATH="$PATH:$ANDROID_HOME/platform-tools"
    log_info "adb agregado al PATH desde Android SDK"
  fi

  # Java: Gradle/AGP de React Native exige JDK 17–21. Gradle usa
  # JAVA_HOME — el `java` del PATH puede ser otra versión.
  local java_bin="${JAVA_HOME:+$JAVA_HOME/bin/java}"
  [[ -x "$java_bin" ]] || java_bin=$(command -v java 2>/dev/null)
  local java_major=""
  if [[ -n "$java_bin" ]]; then
    java_major=$("$java_bin" -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)
  fi
  if [[ -n "$java_major" && ! "$java_major" =~ ^(17|18|19|20|21)$ ]]; then
    log_error "Java $java_major no es compatible — Gradle exige JDK 17–21."
    echo -e "${YELLOW}💡 Apunta JAVA_HOME a un JDK 17–21, ej:${NC}"
    echo -e "   export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64"
    exit 1
  fi

  # Ahora verificar herramientas después de configurar PATH
  command -v npx >/dev/null 2>&1 || missing+=("Node.js/npm (npx)")
  command -v adb >/dev/null 2>&1 || missing+=("Android SDK Platform Tools (adb)")
  command -v keytool >/dev/null 2>&1 || missing+=("Java JDK (keytool)")
  command -v java >/dev/null 2>&1 || missing+=("Java Runtime (java)")
  command -v python3 >/dev/null 2>&1 || missing+=("python3 (fix-signing)")

  if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "Faltan herramientas: ${missing[*]}"
    echo -e "${YELLOW}💡 Instala las herramientas faltantes y reintenta.${NC}"
    exit 1
  fi

  log_success "Prerequisitos verificados ✓ (Java ${java_major:-?})"
}

# ───────────────────────────────────────────────────────────────
# 🧹 LIMPIEZA DE CACHES Y BUILDS ANTERIORES
# ───────────────────────────────────────────────────────────────

clean_project() {
  log_step "Limpiando caches y builds anteriores..."

  # Limpiar directorios de build y cache
  rm -rf android/app/build android/.gradle .expo node_modules/.cache 2>/dev/null || true

  # Limpiar builds de la misma versión en builds/{env}
  local current_version
  current_version=$(node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")

  # Solo limpiar el entorno actual que se está construyendo
  local env_dir="builds/$ENVIRONMENT"
  if [[ -d "$env_dir" ]]; then
    # Buscar archivos con la misma versión actual
    local old_files
    old_files=$(find "$env_dir" -name "*-v${current_version}-${ENVIRONMENT}.*" 2>/dev/null || true)
    if [[ -n "$old_files" ]]; then
      log_info "Eliminando builds anteriores de versión $current_version en $env_dir..."
      echo "$old_files" | while read -r file; do
        rm -f "$file"
        log_info "  Eliminado: $file"
      done
    fi
  fi

  log_success "Limpieza completada ✓"
}

# ───────────────────────────────────────────────────────────────
# 📝 GESTIÓN DE .gitignore
# ───────────────────────────────────────────────────────────────

setup_gitignore() {
  if [[ ! -f ".gitignore" ]]; then
    touch .gitignore
    log_info "Creando .gitignore..."
  fi

  if ! grep -q "^$KEYS_DIR/" .gitignore 2>/dev/null; then
    echo "$KEYS_DIR/" >> .gitignore
    echo "*.keystore" >> .gitignore
    log_success "📝 $KEYS_DIR/ y *.keystore agregados a .gitignore ✓"
  fi

  if ! grep -q "^builds/" .gitignore 2>/dev/null; then
    echo "builds/" >> .gitignore
    log_success "📝 builds/ agregada a .gitignore ✓"
  fi
}

# ───────────────────────────────────────────────────────────────
# 🔐 GESTIÓN DE KEYSTORES Y CREDENCIALES
# ───────────────────────────────────────────────────────────────

generate_keystore() {
  local env="$1"
  local keystore_dir="$KEYS_DIR/$env"
  local keystore_file="$keystore_dir/${env}.keystore"
  local key_alias="${env}-release-key"

  # Crear directorio keys/{env}/ si no existe
  mkdir -p "$keystore_dir"
  setup_gitignore

  # Si ya existe, reutilizar y actualizar gradle.properties (prebuild puede haberlo regenerado)
  if [[ -f "$keystore_file" ]]; then
    log_info "Keystore existente encontrado: $keystore_file"
    # Leer credenciales guardadas en credentials.json si existe
    local creds_file="$keystore_dir/credentials.json"
    if [[ -f "$creds_file" ]]; then
      local saved_store_pass saved_key_pass
      saved_store_pass=$(python3 -c "import json; print(json.load(open('$creds_file'))['storePassword'])" 2>/dev/null || echo "")
      saved_key_pass=$(python3 -c "import json; print(json.load(open('$creds_file'))['keyPassword'])" 2>/dev/null || echo "")
      if [[ -n "$saved_store_pass" && -n "$saved_key_pass" ]]; then
        update_gradle_properties "$env" "$keystore_file" "$key_alias" "$saved_store_pass" "$saved_key_pass"
        log_success "Credenciales cargadas desde $creds_file ✓"
        return 0
      else
        log_warn "⚠️ No se pudieron leer las credenciales de $creds_file"
      fi
    else
      log_warn "⚠️ No existe archivo de credenciales $creds_file"
    fi
    return 0
  fi

  # Si no existe, generar nuevo keystore
  log_warn "🔑 Generando nuevo keystore para [$env] en $keystore_dir..."

  # Generar contraseñas seguras aleatorias
  local store_pass key_pass
  if command -v openssl >/dev/null 2>&1; then
    store_pass=$(openssl rand -base64 12 | tr -d '/+=')
    key_pass=$(openssl rand -base64 12 | tr -d '/+=')
  else
    # Fallback si openssl no está disponible
    store_pass=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 16)
    key_pass=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 16)
    log_warn "⚠️ openssl no disponible. Usando fallback para generar contraseñas."
  fi

  # Generar keystore con keytool (usando formato JKS para máxima compatibilidad)
  keytool -genkey -v \
    -keystore "$keystore_file" \
    -alias "$key_alias" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -storepass "$store_pass" \
    -keypass "$key_pass" \
    -dname "CN=Developer, OU=Mobile, O=App, L=Local, S=Local, C=US" \
    -storetype JKS \
    >/dev/null 2>&1

  log_success "Keystore generado: $keystore_file"

  # Actualizar gradle.properties
  update_gradle_properties "$env" "$keystore_file" "$key_alias" "$store_pass" "$key_pass"

  # Mostrar credenciales de forma destacada
  show_credentials "$env" "$keystore_file" "$key_alias" "$store_pass" "$key_pass"
}

update_gradle_properties() {
  local env="$1" keystore_file="$2" key_alias="$3" store_pass="$4" key_pass="$5"

  # Convertir ruta relativa a absoluta para Gradle
  local absolute_keystore
  absolute_keystore=$(cd "$(dirname "$keystore_file")" && pwd)/$(basename "$keystore_file")

  # Eliminar entradas anteriores de este entorno para evitar duplicados
  if [[ -f "$GRADLE_PROPS" ]]; then
    grep -v "MYAPP_UPLOAD_" "$GRADLE_PROPS" > "$GRADLE_PROPS.tmp" 2>/dev/null || true
    mv "$GRADLE_PROPS.tmp" "$GRADLE_PROPS"
  fi

  # Agregar nuevas variables con prefijo por entorno para evitar conflictos
  cat >> "$GRADLE_PROPS" << EOF

# 🔐 Signing config for $env (auto-generated by build.sh)
MYAPP_UPLOAD_STORE_FILE=$absolute_keystore
MYAPP_UPLOAD_KEY_ALIAS=$key_alias
MYAPP_UPLOAD_STORE_PASSWORD=$store_pass
MYAPP_UPLOAD_KEY_PASSWORD=$key_pass
EOF

  log_success "Gradle properties actualizados en $GRADLE_PROPS ✓"
}

# ───────────────────────────────────────────────────────────────
# 🔨 PREBUILD: GENERAR CÓDIGO NATIVO
# ───────────────────────────────────────────────────────────────

run_prebuild() {
  log_step "Ejecutando expo prebuild (generando código nativo)..."

  if ! npx expo prebuild --platform android --clean; then
    log_error "Error ejecutando expo prebuild"
    echo -e "${YELLOW}💡 Asegúrate de tener las dependencias instaladas: npm install${NC}"
    exit 1
  fi

  # 🔐 Fix signing config para builds release (prebuild regenera build.gradle)
  python3 scripts/fix-signing.py

  log_success "Código nativo generado en android/ ✓"
}

# ───────────────────────────────────────────────────────────────
# 🏗️ COMPILACIÓN CON GRADLE
# ───────────────────────────────────────────────────────────────

get_gradle_config() {
  local env="$1" format="$2"

  case "$env" in
    test)
      echo "assembleDebug:$APK_OUT/debug/app-debug.apk"
      ;;
    staging|production)
      if [[ "$format" == "aab" ]]; then
        echo "bundleRelease:$AAB_OUT/release/app-release.aab"
      else
        echo "assembleRelease:$APK_OUT/release/app-release.apk"
      fi
      ;;
  esac
}

build_app() {
  local env="$1" format="$2"
  local config=$(get_gradle_config "$env" "$format")
  local gradle_task="${config%%:*}"
  local output_path="${config#*:}"

  log_step "Compilando: $gradle_task (${format^^})..."
  log_info "Entorno: $env | Formato: $format"

  cd android

  # Ejecutar gradle con output silencioso pero mostrando errores
  if ! ./gradlew ":app:$gradle_task" --no-daemon -q 2>&1; then
    cd ..
    log_error "Error en compilación Gradle"
    echo -e "${YELLOW}💡 Revisa los errores arriba o ejecuta sin -q para más detalles.${NC}"
    exit 1
  fi

  cd ..

  # Verificar que el archivo existe
  if [[ ! -f "$output_path" ]]; then
    log_error "Archivo no encontrado: $output_path"
    echo -e "${YELLOW}💡 Buscando archivos generados...${NC}"
    find android/app/build -name "*.apk" -o -name "*.aab" 2>/dev/null | head -5 || true
    exit 1
  fi

  # Crear la carpeta del entorno bajo "builds/{env}" si no existe
  local dest_dir="builds/$env"
  mkdir -p "$dest_dir"

  # Extraer dinámicamente name y version de package.json
  local app_pkg_name app_pkg_version
  app_pkg_name=$(node -p "require('./package.json').name" 2>/dev/null || echo "app")
  app_pkg_version=$(node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")

  # Nombrar usando name, version, entorno y formato
  local final_filename="${app_pkg_name}-v${app_pkg_version}-${env}.${format}"
  if [[ "$env" == "test" ]]; then
    final_filename="${app_pkg_name}-v${app_pkg_version}-test-debug.${format}"
  fi

  local final_dest="$dest_dir/$final_filename"
  cp "$output_path" "$final_dest"

  # Mostrar información del archivo
  local file_size=$(du -h "$final_dest" | cut -f1)
  echo -e "\n${GREEN}✅ Build copiado exitosamente a carpeta permanente:${NC}"
  echo -e "   📦 Ruta: $final_dest"
  echo -e "   📏 Tamaño: $file_size"

  # Validar firma del archivo
  validate_signature "$final_dest" "$env"

  echo "$final_dest"
}

# ───────────────────────────────────────────────────────────────
# 🔐 VALIDACIÓN DE FIRMA
# ───────────────────────────────────────────────────────────────

validate_signature() {
  local file_path="$1"
  local env="$2"

  echo -e "\n${CYAN}🔐 Validando firma...${NC}"

  # Buscar apksigner en Android SDK
  local apksigner
  apksigner=$(find "${ANDROID_HOME:-$HOME/Android/Sdk}/build-tools" -name "apksigner" 2>/dev/null | sort -V | tail -1)

  if [[ -z "$apksigner" ]]; then
    log_warn "⚠️ apksigner no encontrado, no se puede validar la firma"
    return
  fi

  if [[ "$file_path" == *.aab ]]; then
    # Para AAB, usar jarsigner
    local sig_check
    sig_check=$(jarsigner -verify "$file_path" 2>&1)
    if echo "$sig_check" | grep -q "jar verified"; then
      log_success "✓ AAB firmado correctamente"
      echo -e "   ${GREEN}🔒 Firma: Release ($env)${NC}"
    else
      log_warn "⚠️ AAB no firmado o firma inválida"
      echo -e "   ${YELLOW}📋 Detalle:${NC} $(echo "$sig_check" | head -3)"
    fi
  else
    # Para APK, usar apksigner
    local sig_output
    sig_output=$("$apksigner" verify --print-certs "$file_path" 2>&1)
    if [[ $? -eq 0 ]]; then
      local cert_dn
      cert_dn=$(echo "$sig_output" | grep "certificate DN" | cut -d: -f2-)
      log_success "✓ APK firmado correctamente"
      echo -e "   ${GREEN}🔒 Firma: Release ($env)${NC}"
      echo -e "   ${CYAN}📋 Certificado:${NC} $cert_dn"
    else
      log_warn "⚠️ APK no firmado o firma inválida"
    fi
  fi
}

# ───────────────────────────────────────────────────────────────
# 📲 INSTALACIÓN EN DISPOSITIVO/EMULADOR
# ───────────────────────────────────────────────────────────────

install_app() {
  local file_path="$1"
  local env="$2"

  # Solo instalar si: no --no-install Y es entorno test
  if [[ "$NO_INSTALL" == true || "$env" != "test" ]]; then
    if [[ "$env" != "test" ]]; then
      if [[ "$file_path" == *.aab ]]; then
        log_warn "ℹ️  Los archivos .aab NO se instalan directamente con adb."
        log_warn "   Úsalos para Google Play o extrae APKs con bundletool."
      else
        log_info "ℹ️  Build de $env generado. Para instalar manualmente:"
        log_info "   adb install -r $file_path"
      fi
    fi
    return
  fi

  # Verificar que haya dispositivo conectado
  if ! adb devices 2>/dev/null | grep -q "device$"; then
    log_warn "No hay dispositivo/emulador conectado. Omitiendo instalación."
    log_info "Conecta un dispositivo o inicia un emulador y reintenta."
    return
  fi

  log_step "Instalando APK en dispositivo/emulador..."

  # Desinstalar versión anterior si existe
  [[ -n "$APP_ID" ]] && adb uninstall "$APP_ID" 2>/dev/null || true

  # Instalar nuevo APK
  if adb install -r "$file_path" 2>&1; then
    log_success "APK instalado exitosamente ✓"
    log_info "🚀 Para ver logs en tiempo real:"
    log_info "   adb logcat"
  else
    log_error "Error al instalar el APK"
    echo -e "${YELLOW}💡 Verifica que el emulador esté corriendo y tenga espacio.${NC}"
  fi
}

# ───────────────────────────────────────────────────────────────
# 🎯 FUNCIÓN PRINCIPAL
# ───────────────────────────────────────────────────────────────

main() {
  local app_name
  app_name=$(node -p "require('./package.json').name" 2>/dev/null || echo "app")
  echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║${NC}  📦 Build Local ${app_name} (${ENVIRONMENT^^} + ${FORMAT^^})  ${BLUE}║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}\n"

  # Ejecutar flujo completo
  check_prerequisites
  clean_project
  run_prebuild

  # Generar/configurar keystore solo para staging/production
  if [[ "$ENVIRONMENT" != "test" ]]; then
    generate_keystore "$ENVIRONMENT"
  fi

  # Compilar aplicación
  local output_file
  output_file=$(build_app "$ENVIRONMENT" "$FORMAT")

  # Instalar si corresponde
  install_app "$output_file" "$ENVIRONMENT"

  # Mensaje final
  echo -e "\n${GREEN}🎉 Build completado exitosamente.${NC}"
  if [[ "$ENVIRONMENT" == "production" && "$FORMAT" == "aab" ]]; then
    echo -e "${YELLOW}🛡️  Para subir a Play Store:${NC}"
    echo -e "   1. Ve a https://play.google.com/console"
    echo -e "   2. Selecciona tu app > Producción > Nueva versión"
    echo -e "   3. Arrastra el archivo: $output_file"
  fi
}

# ───────────────────────────────────────────────────────────────
# 🚀 EJECUCIÓN
# ───────────────────────────────────────────────────────────────

# Manejar ayuda
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo -e "${BLUE}📱 Uso:${NC} bash build.sh [test|staging|production] [OPCIONES]"
  echo -e "\n${BLUE}Entornos:${NC}"
  echo -e "  test       Build debug rápido para emulador (solo APK)"
  echo -e "  staging    Build firmado para testing interno"
  echo -e "  production Build firmado para Play Store"
  echo -e "\n${BLUE}Opciones:${NC}"
  echo -e "  --format apk|aab   Formato de salida (default: apk)"
  echo -e "  --no-install       No instalar automáticamente tras build"
  echo -e "\n${BLUE}Ejemplos:${NC}"
  echo -e "  bash build.sh                           # test + apk"
  echo -e "  bash build.sh staging                   # staging + apk"
  echo -e "  bash build.sh production --format aab   # production + AAB para Play Store"
  echo -e "  bash build.sh staging --no-install      # staging sin instalar"
  exit 0
fi

# Ejecutar main
main
