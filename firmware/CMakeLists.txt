cmake_minimum_required(VERSION 3.13)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)


include(pico_sdk_import.cmake)


include(FreeRTOS_Kernel_import.cmake)

project(irhub_firmware C CXX ASM)

set(PICO_BOARD pico_w)

pico_sdk_init()

add_executable(irhub_firmware
    main.cpp
    src/ir_capture.cpp
    src/ir_transmit.cpp
    src/mqtt_manager.cpp
    src/json_helper.cpp
    src/net_config.cpp
    src/net_config_flash.cpp
    src/ble_provision.cpp
)

target_include_directories(irhub_firmware PRIVATE
    ${CMAKE_CURRENT_LIST_DIR}
    ${CMAKE_CURRENT_LIST_DIR}/include
)

# Wi-Fi and broker settings are normally provisioned over BLE and stored in
# flash. These are optional defaults, used only while nothing is stored:
#   cmake -DWIFI_SSID=... -DWIFI_PASSWORD=... -DMQTT_BROKER_IP=...
# Left empty, an unprovisioned hub starts BLE provisioning at boot.
set(WIFI_SSID "" CACHE STRING "Default Wi-Fi SSID (optional)")
set(WIFI_PASSWORD "" CACHE STRING "Default Wi-Fi password (optional)")
set(MQTT_BROKER_IP "" CACHE STRING "Default Mosquitto broker IPv4 (optional)")
set(MQTT_BROKER_PORT "1883" CACHE STRING "Default Mosquitto broker port")

target_compile_definitions(irhub_firmware PRIVATE
    WIFI_SSID="${WIFI_SSID}"
    WIFI_PASSWORD="${WIFI_PASSWORD}"
    MQTT_BROKER_IP="${MQTT_BROKER_IP}"
    MQTT_BROKER_PORT=${MQTT_BROKER_PORT}
    CYW43_HOST_NAME="irhub-pico"
    PICO_MALLOC_PANIC=1
    CYW43_TASK_STACK_SIZE=4096
    # flash_safe_execute (net_config and BTstack's bond storage) otherwise
    # refuses to run under FreeRTOS on RP2040. True here: FreeRTOS runs on
    # core 0 only and core 1 is never launched.
    PICO_FLASH_ASSUME_CORE1_SAFE=1
)

target_link_libraries(irhub_firmware
    pico_stdlib
    pico_cyw43_arch_lwip_sys_freertos
    pico_lwip_mqtt
    hardware_pio
    hardware_pwm
    hardware_timer
    hardware_gpio
    hardware_clocks
    hardware_irq
    FreeRTOS-Kernel-Heap4
    pico_btstack_ble
    pico_btstack_cyw43
    pico_flash
    hardware_flash
)

# BLE provisioning GATT table -> generated irhub_provision.h
pico_btstack_make_gatt_header(irhub_firmware PRIVATE
    "${CMAKE_CURRENT_LIST_DIR}/src/irhub_provision.gatt")

# RAM is tight (see FreeRTOSConfig.h); show usage on every link.
target_link_options(irhub_firmware PRIVATE -Wl,--print-memory-usage)

pico_enable_stdio_usb(irhub_firmware 1)
pico_enable_stdio_uart(irhub_firmware 0)

pico_add_extra_outputs(irhub_firmware)
