# ⚡ SimuZ Firmware Update Tool

A simple web-based tool to flash firmware binaries (.bin) to an ESP32 via USB, directly from your browser — no installation required.

## Features
- Load a .bin firmware file from your computer
- Connect to your ESP32 via USB (Web Serial API)
- Flash the firmware directly from the browser
- Real-time log output

## Requirements
- Google Chrome or Microsoft Edge
- ESP32 connected via USB

## Usage
1. Open the app URL in Chrome or Edge
2. Click Connect ESP32 and select the serial port
3. Select your .bin firmware file
4. Click Flash Firmware
5. Wait for the process to complete

## Notes
- Only works in Chromium-based browsers (Chrome, Edge)
- Make sure your ESP32 drivers are installed (CP210x or CH340)
- Default flash address: 0x1000

## License
MIT