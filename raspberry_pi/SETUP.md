# Connect a real Raspberry Pi to the dashboard

```
 GPS + 3x HC-SR04 + LiDAR + IMU + camera --> Raspberry Pi  (node "PI", PRIMARY) --\
                                                                                   +--> POST /update --> dashboard
 GPS + 3x HC-SR04 + OLED ----------------> ESP32           (node "ESP32_BACKUP") --/
```

**Required server / dashboard / firmware changes are already included in this project:**
`server.py` (LiDAR + IMU fields, Pi/ESP32 failover, sensor fusion, impact/tilt events),
`templates/index.html` (status line under the Truck 1 hardware badge) and the ESP32
`.ino` files (now identify as `ESP32_BACKUP`). **Re-flash the ESP32** with the new firmware.

## How the ESP32 backup works

- Both devices POST to the same `/update` for `TRUCK_01`.
- While the Pi is alive, ESP32 packets are accepted but **ignored** (standby).
- If the Pi is silent for **4 s**, the server automatically uses the ESP32's data
  (`NODE_FAILOVER` event in the safety log) and switches back when the Pi returns.
- The dashboard shows both nodes (🟢/🔴), with ★ on the active one.
- If the ESP32 is still on the OLD firmware it sends no node name and is treated as
  a primary, so it would fight the Pi. Re-flash it.

## How the extra sensors are used

| Sensor | What the dashboard does |
|---|---|
| LiDAR | `front distance = min(ultrasonic, LiDAR)`: the closer reading drives STOP / SLOW DOWN |
| IMU | shows pitch / roll / g; `IMPACT_DETECTED` (>= 2.5 g) and `TILT_WARNING` (>= 25 deg) safety events; tilt sets status to CAUTION. Tune `IMU_IMPACT_G` / `IMU_TILT_WARN_DEG` in `server.py` |

## 1. Wiring (BCM GPIO numbers)

| Part | Pi connection |
|---|---|
| GPS NEO-6M TX | Pi RX = GPIO15 (pin 10) |
| GPS NEO-6M RX | Pi TX = GPIO14 (pin 8) |
| GPS VCC / GND | 3.3V (pin 1) or 5V (pin 2) per your module / GND |
| HC-SR04 front | TRIG GPIO23, ECHO GPIO24 |
| HC-SR04 left  | TRIG GPIO17, ECHO GPIO27 |
| HC-SR04 right | TRIG GPIO5,  ECHO GPIO6 |
| HC-SR04 VCC / GND | 5V / GND |
| IMU MPU6050 SDA / SCL | GPIO2 (pin 3) / GPIO3 (pin 5), VCC 3.3V, GND |
| LiDAR TF-Luna / TFmini | **USB-TTL adapter** -> `/dev/ttyUSB0` (the Pi's main UART is used by the GPS). 5V, GND, LiDAR TX -> adapter RX |
| LiDAR RPLIDAR A1/C1 | its USB adapter -> `/dev/ttyUSB0` (put GPS on the Pi UART, LiDAR on USB; if you have two USB serial devices use `/dev/ttyUSB1`) |

IMU mounting: X forward, Y left, Z up. Keep the truck still for the first second after
start (the gyro calibrates). Check it is seen with `sudo i2cdetect -y 1` (expect `68`).

**ECHO pins output 5V and the Pi GPIO is 3.3V only.** Put a divider on every ECHO
line: ECHO -> 1kΩ -> GPIO pin, and GPIO pin -> 2kΩ -> GND. Without it you can
damage the Pi. Change pins in `SONAR_PINS` at the top of `pi_node.py` if needed.

## 2. Pi setup

```bash
sudo raspi-config
#  Interface Options -> I2C  -> Enable   (for the IMU)
#  Interface Options -> Serial Port
#    "login shell over serial?"  -> No
#    "serial hardware enabled?"  -> Yes      then reboot

sudo apt update && sudo apt install -y python3-venv python3-opencv i2c-tools
cd ~/raspberry_pi                 # copy this folder to the Pi
python3 -m venv venv --system-site-packages
source venv/bin/activate
pip install -r requirements-pi.txt

# Check the GPS is talking (you should see $GPRMC / $GNGGA lines)
cat /dev/serial0
```

## 3. Network

The Pi must reach the machine running `server.py`.

- **Same Wi-Fi / hotspot:** find the laptop IP (`ipconfig` / `ip a`) and use
  `http://<laptop-ip>:5000`. Start the server so it listens on all interfaces,
  and allow port 5000 through the laptop firewall.
- **Deployed (Railway):** use your `https://...up.railway.app` URL. Nothing else changes.

Test reachability from the Pi: `curl http://<laptop-ip>:5000/api/fleet`

## 4. Run

```bash
# 1) No hardware, just prove the link works
python3 pi_node.py --sim --server http://<laptop-ip>:5000

# 2) Real GPS + sonars
python3 pi_node.py --server http://<laptop-ip>:5000 --vehicle TRUCK_01

# 2b) Everything: GPS + sonars + LiDAR + IMU + camera
python3 pi_node.py --server http://<laptop-ip>:5000 --lidar tfluna --imu --camera
#     RPLIDAR instead:  --lidar rplidar --lidar-offset 0   (offset = degrees so 0 = straight ahead)
#     other port:       --lidar-port /dev/ttyUSB1

# 3) Also stream the camera (shows in the dashboard's raw/dehazed feed)
python3 pi_node.py --server http://<laptop-ip>:5000 --camera
```

On the dashboard, Truck 1 flips to **REAL ESP32/hardware -> CONNECTED_LIVE**.
If the Pi is silent for 12 s it shows `LINK_TIMEOUT`.

Indoors the GPS has no fix, so the node sends the fallback coordinates
(`FALLBACK_LAT/LNG`) with `gps_valid=false`. Take it outside for a real fix
(first fix can take a few minutes).

## 5. Run on boot

Edit the IP in `haul-node.service`, then:

```bash
sudo cp haul-node.service /etc/systemd/system/
sudo systemctl enable --now haul-node
journalctl -u haul-node -f
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `[FAIL] Connection refused/timeout` | wrong IP, firewall, or Pi and laptop on different networks |
| `404 Unknown vehicle_id` | use one of the IDs the server knows (`TRUCK_01`..`TRUCK_06`) |
| No `[GPS]` lines / never a fix | serial console still enabled, TX/RX swapped, or antenna indoors |
| Front distance always 250 | ECHO wiring / divider wrong, or sensor not on 5V |
| Truck 1 not marked real | it only flips after the first successful POST; check server log for `POST /update 200` |
| `LiDAR ✖ (no data)` | wrong port/baud, TX/RX swapped, or amplitude too low (sensor pointed at glass / too close < 20 cm) |
| IMU `[IMU] ... Remote I/O error` | I2C not enabled, wrong wiring, or address is 0x69 (change `addr` in `MPU6050`) |
| Pitch/roll inverted | board mounted differently: swap/negate axes in `MPU6050.run()` |
| Both nodes fight / positions jump | ESP32 not re-flashed (no `node` field) |
| Camera fails | `--camera-index 1`, or on Pi Camera modules use `libcamera-hello` to confirm the camera works first |
