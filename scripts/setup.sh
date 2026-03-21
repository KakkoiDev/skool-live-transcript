#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VENDOR_DIR="$PROJECT_DIR/vendor"
WHISPER_DIR="$VENDOR_DIR/whisper.cpp"
MODEL_NAME="ggml-tiny.en-q5_1.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL_NAME"

echo "=== Skool Live Transcript Setup ==="

# Check dependencies
for cmd in cmake g++ pw-record ffmpeg; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "ERROR: $cmd is required but not installed."
    exit 1
  fi
done

mkdir -p "$VENDOR_DIR"

# Clone or update whisper.cpp
if [ -d "$WHISPER_DIR" ]; then
  echo "whisper.cpp already cloned, pulling latest..."
  cd "$WHISPER_DIR" && git pull
else
  echo "Cloning whisper.cpp..."
  git clone https://github.com/ggml-org/whisper.cpp "$WHISPER_DIR"
fi

# Build
echo "Building whisper.cpp..."
cd "$WHISPER_DIR"
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j$(nproc)

# Verify binary
if [ ! -f "$WHISPER_DIR/build/bin/whisper-cli" ]; then
  echo "ERROR: whisper-cli binary not found after build"
  exit 1
fi

echo "whisper-cli built successfully"

# Download model
MODEL_DIR="$WHISPER_DIR/models"
mkdir -p "$MODEL_DIR"

if [ -f "$MODEL_DIR/$MODEL_NAME" ]; then
  echo "Model $MODEL_NAME already downloaded"
else
  echo "Downloading $MODEL_NAME (31 MiB)..."
  curl -L -o "$MODEL_DIR/$MODEL_NAME" "$MODEL_URL"
fi

echo ""
echo "=== Setup complete ==="
echo "Binary: $WHISPER_DIR/build/bin/whisper-cli"
echo "Model:  $MODEL_DIR/$MODEL_NAME"
echo ""
echo "Install npm dependencies: cd $PROJECT_DIR && npm install"
