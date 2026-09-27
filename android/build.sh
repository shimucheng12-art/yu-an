#!/usr/bin/env bash
# 余安 Android APK 一键构建脚本（无需 Gradle）
# 依赖：JDK 17+、Android build-tools 34、platform android-34（android.jar）
# 用法：SDK_ROOT=/path/to/android-sdk ./build.sh
# 产物：../yu-an-v4.0-beta.apk（已 zipalign + apksigner 签名）
set -euo pipefail
cd "$(dirname "$0")"

SDK_ROOT="${SDK_ROOT:-$HOME/Android/Sdk}"
BT="$SDK_ROOT/build-tools/34.0.0"
PLAT="$SDK_ROOT/platforms/android-34/android.jar"
[ -x "$BT/aapt2" ] || { echo "找不到 aapt2（$BT）"; exit 1; }
[ -f "$PLAT" ] || { echo "找不到 android.jar（$PLAT）"; exit 1; }

VER_CODE=41; VER_NAME=4.1-beta
OUT=build; APK="../yu-an-v$VER_NAME.apk"
rm -rf "$OUT"; mkdir -p "$OUT/classes"

echo "[1/7] 编译资源…"
"$BT/aapt2" compile --dir res -o "$OUT/res.zip"

echo "[2/7] 链接资源与清单…"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$PLAT" --manifest AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VER_CODE" --version-name "$VER_NAME" \
  --java "$OUT/gen" \
  -A assets "$OUT/res.zip"

echo "[3/7] 编译 Java…"
javac -source 1.8 -target 1.8 -bootclasspath "$PLAT" -d "$OUT/classes" \
  $(find "$OUT/gen" -name 'R.java') \
  src/io/github/shimucheng12art/yuan/MainActivity.java

echo "[4/7] 转 DEX…"
"$BT/d8" --release --lib "$PLAT" --min-api 24 --output "$OUT" \
  $(find "$OUT/classes" -name '*.class')

echo "[5/7] 打包 + 对齐…"
( cd "$OUT" && zip -q base.apk classes.dex )
"$BT/zipalign" -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"

echo "[6/7] 签名…"
KS=${KS:-../yu-an.keystore}
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -alias yuan -keyalg RSA -keysize 2048 \
    -validity 10950 -storepass yuanyuan -keypass yuanyuan \
    -dname "CN=YuAn, OU=YuAn, O=shimucheng12-art, C=CN"
  echo "已生成新签名密钥 $KS（请妥善保管，勿提交到仓库）"
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:yuanyuan --key-pass pass:yuanyuan \
  --out "$APK" "$OUT/aligned.apk"

echo "[7/7] 校验…"
"$BT/apksigner" verify --print-certs "$APK"
echo "✅ 构建完成：$(cd .. && pwd)/yu-an-v$VER_NAME.apk"
