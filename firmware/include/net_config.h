#pragma once

//Network settings provisioned over BLE (or given as -D defaults at build time)
//and persisted in one flash sector.
//
//This header and net_config.cpp are pure logic with no Pico/FreeRTOS/lwIP
//dependency, so firmware/test can compile them on the host. The flash I/O
//lives in net_config_flash.cpp.

#include <cstddef>
#include <cstdint>

namespace net_config {

constexpr size_t SSID_MAX = 32;    //802.11 limit, bytes
constexpr size_t PASS_MAX = 63;    //WPA2 passphrase limit
constexpr size_t PASS_MIN = 8;     //0 is also allowed, meaning an open network
constexpr size_t HOST_MAX = 63;    //IPv4 text today; room for a DNS name later

struct NetConfig {
    char ssid[SSID_MAX + 1];
    char password[PASS_MAX + 1];
    char broker_host[HOST_MAX + 1];
    uint16_t broker_port;
};

enum class Source : uint8_t { None, BuildDefaults, Flash };

//Values match the "reason" byte of the BLE status characteristic when the
//state is Invalid, so keep them stable.
enum class Invalid : uint8_t { Ok = 0, Ssid, Password, Host, Port };

Invalid validate(const NetConfig &c);

//Dotted-quad IPv4 only ("192.168.1.100"). Rejects 0.0.0.0, leading/trailing
//junk and octets > 255. out is in network order (a.b.c.d -> {a,b,c,d}).
bool parse_ipv4(const char *s, uint8_t out[4]);

uint32_t crc32(const void *data, size_t len);

//The on-flash record fills exactly one flash page.
constexpr size_t RECORD_BYTES = 256;

//Writes the record followed by 0xFF padding. Returns bytes written
//(RECORD_BYTES) or 0 if len is too small.
size_t serialize(const NetConfig &c, uint8_t *page, size_t len);

//Checks magic, version, size, CRC, NUL termination and validate().
bool parse(const uint8_t *page, size_t len, NetConfig &out);

//From the WIFI_SSID / WIFI_PASSWORD / MQTT_BROKER_IP / MQTT_BROKER_PORT
//compile definitions. False when they are unset or still the placeholder.
bool build_defaults(NetConfig &out);

//---- flash (net_config_flash.cpp, target only) ----

//Flash record, then build defaults, then None (out zeroed).
Source load(NetConfig &out);

//Erases the config sector, programs one page and reads it back to verify.
//Interrupts on this core are off for the duration (~45ms), so an IR capture
//in flight at that moment is lost.
bool save(const NetConfig &c);

bool erase();

} //namespace net_config
