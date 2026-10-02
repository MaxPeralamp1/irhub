#include "net_config.h"

#include <cstring>

//Build-time defaults. CMake always defines these for the firmware; the
//fallbacks let the host test compile this file on its own.
#ifndef WIFI_SSID
#define WIFI_SSID ""
#endif
#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD ""
#endif
#ifndef MQTT_BROKER_IP
#define MQTT_BROKER_IP ""
#endif
#ifndef MQTT_BROKER_PORT
#define MQTT_BROKER_PORT 1883
#endif

namespace net_config {

namespace {

//Record layout, written byte by byte so struct padding never reaches flash
//or the CRC:
//
//  0  u32 magic 'IRNC'      8  ssid[33]      105 host[64]
//  4  u16 version           41 password[64]  169 u16 port
//  6  u16 payload size                       171 u32 crc32 of bytes 0..170
constexpr uint32_t MAGIC = 0x434E5249; //"IRNC" little-endian
constexpr uint16_t VERSION = 1;
constexpr size_t OFF_SSID = 8;
constexpr size_t OFF_PASS = OFF_SSID + SSID_MAX + 1;
constexpr size_t OFF_HOST = OFF_PASS + PASS_MAX + 1;
constexpr size_t OFF_PORT = OFF_HOST + HOST_MAX + 1;
constexpr size_t OFF_CRC = OFF_PORT + 2;
constexpr size_t RECORD_USED = OFF_CRC + 4;
constexpr uint16_t PAYLOAD_SIZE = (uint16_t)(OFF_CRC - OFF_SSID);
static_assert(RECORD_USED <= RECORD_BYTES, "net_config record outgrew a flash page");

void put16(uint8_t *p, uint16_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }
void put32(uint8_t *p, uint32_t v) { for (int i = 0; i < 4; i++) p[i] = (uint8_t)(v >> (8 * i)); }
uint16_t get16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }
uint32_t get32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

//strnlen is POSIX, not C++17; this also reports whether a NUL was found.
size_t bounded_len(const char *s, size_t cap, bool &terminated) {
    for (size_t i = 0; i < cap; i++) {
        if (s[i] == '\0') { terminated = true; return i; }
    }
    terminated = false;
    return cap;
}

} //namespace

bool parse_ipv4(const char *s, uint8_t out[4]) {
    uint8_t tmp[4];
    for (int part = 0; part < 4; part++) {
        if (part > 0) {
            if (*s != '.') return false;
            s++;
        }
        int digits = 0;
        unsigned v = 0;
        while (*s >= '0' && *s <= '9') {
            v = v * 10 + (unsigned)(*s - '0');
            s++;
            if (++digits > 3 || v > 255) return false;
        }
        if (digits == 0) return false;
        tmp[part] = (uint8_t)v;
    }
    if (*s != '\0') return false;
    if ((tmp[0] | tmp[1] | tmp[2] | tmp[3]) == 0) return false;
    memcpy(out, tmp, 4);
    return true;
}

Invalid validate(const NetConfig &c) {
    bool term;
    size_t n = bounded_len(c.ssid, sizeof(c.ssid), term);
    if (!term || n == 0 || n > SSID_MAX) return Invalid::Ssid;

    n = bounded_len(c.password, sizeof(c.password), term);
    if (!term || n > PASS_MAX || (n != 0 && n < PASS_MIN)) return Invalid::Password;

    n = bounded_len(c.broker_host, sizeof(c.broker_host), term);
    uint8_t ip[4];
    if (!term || n == 0 || !parse_ipv4(c.broker_host, ip)) return Invalid::Host;

    if (c.broker_port == 0) return Invalid::Port;
    return Invalid::Ok;
}

uint32_t crc32(const void *data, size_t len) {
    //Bitwise CRC-32 (IEEE, reflected). A 1KB table is not worth it for one
    //175-byte record read at boot.
    const uint8_t *p = static_cast<const uint8_t *>(data);
    uint32_t crc = 0xFFFFFFFFu;
    while (len--) {
        crc ^= *p++;
        for (int k = 0; k < 8; k++) crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
    }
    return ~crc;
}

size_t serialize(const NetConfig &c, uint8_t *page, size_t len) {
    if (len < RECORD_BYTES) return 0;
    memset(page, 0xFF, RECORD_BYTES);
    put32(page, MAGIC);
    put16(page + 4, VERSION);
    put16(page + 6, PAYLOAD_SIZE);
    //Copy whole fields (zero-filled past the NUL) so stale bytes from a
    //previous, longer value never end up in flash.
    memset(page + OFF_SSID, 0, OFF_PORT - OFF_SSID);
    strncpy(reinterpret_cast<char *>(page + OFF_SSID), c.ssid, SSID_MAX);
    strncpy(reinterpret_cast<char *>(page + OFF_PASS), c.password, PASS_MAX);
    strncpy(reinterpret_cast<char *>(page + OFF_HOST), c.broker_host, HOST_MAX);
    put16(page + OFF_PORT, c.broker_port);
    put32(page + OFF_CRC, crc32(page, OFF_CRC));
    return RECORD_BYTES;
}

bool parse(const uint8_t *page, size_t len, NetConfig &out) {
    if (len < RECORD_USED) return false;
    if (get32(page) != MAGIC) return false;
    if (get16(page + 4) != VERSION) return false;
    if (get16(page + 6) != PAYLOAD_SIZE) return false;
    if (get32(page + OFF_CRC) != crc32(page, OFF_CRC)) return false;

    NetConfig c;
    memcpy(c.ssid, page + OFF_SSID, sizeof(c.ssid));
    memcpy(c.password, page + OFF_PASS, sizeof(c.password));
    memcpy(c.broker_host, page + OFF_HOST, sizeof(c.broker_host));
    c.broker_port = get16(page + OFF_PORT);
    //validate() also rejects any field without a NUL inside it.
    if (validate(c) != Invalid::Ok) return false;
    out = c;
    return true;
}

bool build_defaults(NetConfig &out) {
    //"YOUR_WIFI_SSID" was the CMake placeholder before provisioning existed;
    //an old build directory can still have it cached.
    if (strcmp(WIFI_SSID, "") == 0 || strcmp(WIFI_SSID, "YOUR_WIFI_SSID") == 0) return false;
    if (strlen(WIFI_SSID) > SSID_MAX || strlen(WIFI_PASSWORD) > PASS_MAX ||
        strlen(MQTT_BROKER_IP) > HOST_MAX) {
        return false;
    }

    NetConfig c{};
    strcpy(c.ssid, WIFI_SSID);
    strcpy(c.password, WIFI_PASSWORD);
    strcpy(c.broker_host, MQTT_BROKER_IP);
    c.broker_port = (uint16_t)(MQTT_BROKER_PORT);
    if (validate(c) != Invalid::Ok) return false;
    out = c;
    return true;
}

} //namespace net_config
