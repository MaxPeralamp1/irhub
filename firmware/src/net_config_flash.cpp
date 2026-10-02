#include "net_config.h"

#include <cstdio>
#include <cstring>

#include "pico/flash.h"
#include "hardware/flash.h"
#include "pico/btstack_flash_bank.h"

//The flash half of net_config: where the record lives and how it is written.

namespace net_config {

namespace {

//BTstack keeps its bonding TLV in the PICO_FLASH_BANK_TOTAL_SIZE bytes at
//PICO_FLASH_BANK_STORAGE_OFFSET (the top of flash) and may erase them on
//first boot. Our sector sits directly below. Reflashing a UF2 leaves both
//untouched, so a provisioned hub keeps its settings across firmware updates.
constexpr uint32_t CONFIG_OFFSET = PICO_FLASH_BANK_STORAGE_OFFSET - FLASH_SECTOR_SIZE;

static_assert(RECORD_BYTES == FLASH_PAGE_SIZE, "record is written as one flash page");

//Written from NetworkTask only, but kept static: 256 bytes is not worth the
//stack, and flash_range_program wants the source in RAM regardless.
static uint8_t s_page[FLASH_PAGE_SIZE];

const uint8_t *config_in_xip() {
    return reinterpret_cast<const uint8_t *>(XIP_BASE + CONFIG_OFFSET);
}

extern "C" char __flash_binary_end;

//The linker has no idea this sector is in use, so a large enough image would
//silently overlap it. Checked before every write.
bool binary_clear_of_config() {
    uintptr_t end = reinterpret_cast<uintptr_t>(&__flash_binary_end) - XIP_BASE;
    if (end > CONFIG_OFFSET) {
        printf("[cfg] FATAL: firmware image (%u bytes) overlaps config sector at 0x%x\n",
               (unsigned)end, (unsigned)CONFIG_OFFSET);
        return false;
    }
    return true;
}

void do_erase(void *) { flash_range_erase(CONFIG_OFFSET, FLASH_SECTOR_SIZE); }
void do_program(void *) { flash_range_program(CONFIG_OFFSET, s_page, FLASH_PAGE_SIZE); }

//flash_safe_execute disables interrupts on this core for the duration. It
//needs PICO_FLASH_ASSUME_CORE1_SAFE (see CMakeLists.txt): FreeRTOS runs on
//core 0 only and core 1 is never launched.
bool run_safely(void (*fn)(void *)) {
    int rc = flash_safe_execute(fn, nullptr, 1000);
    if (rc != PICO_OK) {
        printf("[cfg] flash_safe_execute failed: %d\n", rc);
        return false;
    }
    return true;
}

} //namespace

Source load(NetConfig &out) {
    memcpy(s_page, config_in_xip(), sizeof(s_page));
    if (parse(s_page, sizeof(s_page), out)) {
        printf("[cfg] using stored settings: SSID '%s', broker %s:%u\n",
               out.ssid, out.broker_host, (unsigned)out.broker_port);
        return Source::Flash;
    }
    if (build_defaults(out)) {
        printf("[cfg] no stored settings, using build defaults: SSID '%s', broker %s:%u\n",
               out.ssid, out.broker_host, (unsigned)out.broker_port);
        return Source::BuildDefaults;
    }
    memset(&out, 0, sizeof(out));
    printf("[cfg] no stored settings and no build defaults - unprovisioned\n");
    return Source::None;
}

bool save(const NetConfig &c) {
    if (validate(c) != Invalid::Ok || !binary_clear_of_config()) return false;
    serialize(c, s_page, sizeof(s_page));
    if (!run_safely(do_erase) || !run_safely(do_program)) return false;

    NetConfig check;
    if (!parse(config_in_xip(), FLASH_PAGE_SIZE, check) ||
        memcmp(config_in_xip(), s_page, FLASH_PAGE_SIZE) != 0) {
        printf("[cfg] flash verify failed after write\n");
        return false;
    }
    printf("[cfg] settings saved to flash\n");
    return true;
}

bool erase() {
    if (!binary_clear_of_config()) return false;
    if (!run_safely(do_erase)) return false;
    printf("[cfg] stored settings erased\n");
    return true;
}

} //namespace net_config
