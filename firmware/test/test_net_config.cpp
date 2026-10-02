// Host-side tests for the provisioned network config record.
//
// net_config.cpp is pure logic, so it is compiled as-is. Build defaults are
// exercised by compiling it a second time with -D values (see run_test.sh),
// selected here by NET_CONFIG_TEST_DEFAULTS.

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>

#include "net_config.h"

using namespace net_config;

static int g_pass = 0, g_fail = 0;

static void check(bool cond, const std::string &what) {
    printf(cond ? "  PASS  %s\n" : "  FAIL  %s\n", what.c_str());
    cond ? g_pass++ : g_fail++;
}

static NetConfig good() {
    NetConfig c{};
    strcpy(c.ssid, "HomeNet");
    strcpy(c.password, "hunter2hunter2");
    strcpy(c.broker_host, "192.168.1.100");
    c.broker_port = 1883;
    return c;
}

static void test_crc() {
    printf("crc32\n");
    // Standard check value for CRC-32/ISO-HDLC.
    check(crc32("123456789", 9) == 0xCBF43926u, "check value of \"123456789\"");
    check(crc32("", 0) == 0u, "empty input");
}

static void test_ipv4() {
    printf("parse_ipv4\n");
    uint8_t ip[4] = {};
    check(parse_ipv4("192.168.1.100", ip) && ip[0] == 192 && ip[3] == 100, "plain address");
    check(parse_ipv4("10.0.0.1", ip), "zeros inside");
    check(parse_ipv4("255.255.255.255", ip), "all 255");
    check(!parse_ipv4("0.0.0.0", ip), "rejects 0.0.0.0");
    check(!parse_ipv4("256.1.1.1", ip), "rejects octet > 255");
    check(!parse_ipv4("1.2.3", ip), "rejects three parts");
    check(!parse_ipv4("1.2.3.4.5", ip), "rejects five parts");
    check(!parse_ipv4("1.2.3.4 ", ip), "rejects trailing space");
    check(!parse_ipv4("1..3.4", ip), "rejects empty part");
    check(!parse_ipv4("0001.2.3.4", ip), "rejects four-digit part");
    check(!parse_ipv4("broker.lan", ip), "rejects hostname");
    check(!parse_ipv4("", ip), "rejects empty");
}

static void test_validate() {
    printf("validate\n");
    NetConfig c = good();
    check(validate(c) == Invalid::Ok, "good config");

    c = good(); c.ssid[0] = '\0';
    check(validate(c) == Invalid::Ssid, "empty SSID");
    c = good(); memset(c.ssid, 'a', 32); c.ssid[32] = '\0';
    check(validate(c) == Invalid::Ok, "32-byte SSID");
    c = good(); memset(c.ssid, 'a', sizeof(c.ssid));
    check(validate(c) == Invalid::Ssid, "SSID without NUL");

    c = good(); c.password[0] = '\0';
    check(validate(c) == Invalid::Ok, "empty password (open network)");
    c = good(); strcpy(c.password, "1234567");
    check(validate(c) == Invalid::Password, "7-char password");
    c = good(); strcpy(c.password, "12345678");
    check(validate(c) == Invalid::Ok, "8-char password");
    c = good(); memset(c.password, 'p', 63); c.password[63] = '\0';
    check(validate(c) == Invalid::Ok, "63-char password");
    c = good(); memset(c.password, 'p', sizeof(c.password));
    check(validate(c) == Invalid::Password, "password without NUL");

    c = good(); strcpy(c.broker_host, "not-an-ip");
    check(validate(c) == Invalid::Host, "bad host");
    c = good(); c.broker_port = 0;
    check(validate(c) == Invalid::Port, "port 0");
    c = good(); c.broker_port = 65535;
    check(validate(c) == Invalid::Ok, "port 65535");
}

static void test_round_trip() {
    printf("serialize / parse\n");
    uint8_t page[RECORD_BYTES];
    NetConfig in = good();
    check(serialize(in, page, sizeof(page)) == RECORD_BYTES, "serialize fills one page");
    check(serialize(in, page, RECORD_BYTES - 1) == 0, "refuses short buffer");
    serialize(in, page, sizeof(page));

    NetConfig out{};
    check(parse(page, sizeof(page), out), "parses what it wrote");
    check(strcmp(out.ssid, in.ssid) == 0 && strcmp(out.password, in.password) == 0 &&
          strcmp(out.broker_host, in.broker_host) == 0 && out.broker_port == in.broker_port,
          "fields round-trip");
    check(page[RECORD_BYTES - 1] == 0xFF, "tail is erased-flash padding");

    // A longer value followed by a shorter one must not leave stale bytes.
    NetConfig longer = good();
    strcpy(longer.ssid, "AVeryLongNetworkName");
    serialize(longer, page, sizeof(page));
    serialize(in, page, sizeof(page));
    check(page[8 + strlen(in.ssid) + 1] == 0, "no stale bytes after a shorter SSID");

    uint8_t blank[RECORD_BYTES];
    memset(blank, 0xFF, sizeof(blank));
    check(!parse(blank, sizeof(blank), out), "rejects erased flash");

    uint8_t bad[RECORD_BYTES];
    memcpy(bad, page, sizeof(bad)); bad[0] ^= 1;
    check(!parse(bad, sizeof(bad), out), "rejects bad magic");
    memcpy(bad, page, sizeof(bad)); bad[4] = 2;
    check(!parse(bad, sizeof(bad), out), "rejects unknown version");
    memcpy(bad, page, sizeof(bad)); bad[20] ^= 0x40;
    check(!parse(bad, sizeof(bad), out), "rejects flipped payload bit (CRC)");

    // A record whose CRC is correct but whose content is invalid, as a
    // firmware bug could once have written: still refused.
    NetConfig weird = good();
    weird.broker_port = 0;
    serialize(weird, page, sizeof(page));
    check(!parse(page, sizeof(page), out), "rejects valid-CRC record that fails validate()");
}

static void test_defaults() {
    printf("build_defaults\n");
    NetConfig c{};
#ifdef NET_CONFIG_TEST_DEFAULTS
    check(build_defaults(c), "set -D values are accepted");
    check(strcmp(c.ssid, "LabNet") == 0 && c.broker_port == 1884, "values come from -D");
#else
    check(!build_defaults(c), "no -D values -> no defaults");
#endif
}

int main() {
    test_crc();
    test_ipv4();
    test_validate();
    test_round_trip();
    test_defaults();
    printf("\n%d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
