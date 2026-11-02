#!/usr/bin/env python3
"""
Fix android/app/build.gradle signing config after expo prebuild.
Must be run after npx expo prebuild since prebuild regenerates android/ from templates.

Falla (exit 1) si el template de Expo cambió y el parche no pudo aplicarse —
un release firmado con el cert debug es un error silencioso peor que un
build abortado. Verificar el mensaje y ajustar los strings del replace.
"""
import sys

BUILD_GRADLE = "android/app/build.gradle"


def main():
    try:
        with open(BUILD_GRADLE, "r") as f:
            content = f.read()
    except FileNotFoundError:
        print(f"❌ {BUILD_GRADLE} not found. Run npx expo prebuild first.")
        return 1

    original = content

    # 1. Fix: change signingConfig signingConfigs.debug -> signingConfigs.release
    #    inside the release buildType only (el del template RN/Expo).
    content = content.replace(
        "        release {\n            // Caution! In production, you need to generate your own keystore file.\n            // see https://reactnative.dev/docs/signed-apk-android.\n            signingConfig signingConfigs.debug",
        "        release {\n            // Caution! In production, you need to generate your own keystore file.\n            // see https://reactnative.dev/docs/signed-apk-android.\n            signingConfig signingConfigs.release",
    )

    # 2. Add release signing config block after debug block, if not already present
    if "signingConfigs {" in content:
        configs_part = content.split("signingConfigs {")[1].split("}")[0]
        if "release {" not in configs_part:
            old_debug = """        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }"""

            new_debug_release = """        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (project.hasProperty("MYAPP_UPLOAD_STORE_FILE")) {
                storeFile file(MYAPP_UPLOAD_STORE_FILE)
                storePassword MYAPP_UPLOAD_STORE_PASSWORD
                keyAlias MYAPP_UPLOAD_KEY_ALIAS
                keyPassword MYAPP_UPLOAD_KEY_PASSWORD
            }
        }"""

            content = content.replace(old_debug, new_debug_release)

    # Verificación: el buildType release debe firmar con signingConfigs.release
    # (si el replace #1 no aplicó, queda signingConfigs.debug) y debe existir
    # el signingConfig release alimentado por MYAPP_UPLOAD_* de gradle.properties.
    release_ok = "signingConfig signingConfigs.release" in content
    signing_ok = "MYAPP_UPLOAD_STORE_FILE" in content

    if not (release_ok and signing_ok):
        print(
            "❌ No se pudo aplicar el fix de firma en android/app/build.gradle\n"
            "   El template de Expo cambió — ajustar los strings del replace\n"
            "   en scripts/fix-signing.py o editar build.gradle a mano:\n"
            "   - buildTypes.release → signingConfig signingConfigs.release\n"
            "   - signingConfigs.release → props MYAPP_UPLOAD_* de gradle.properties"
        )
        return 1

    if content != original:
        with open(BUILD_GRADLE, "w") as f:
            f.write(content)
        print("✅ Signing config fixed in android/app/build.gradle")
    else:
        print("✅ Signing config ya correcto en android/app/build.gradle")
    return 0


if __name__ == "__main__":
    sys.exit(main())
